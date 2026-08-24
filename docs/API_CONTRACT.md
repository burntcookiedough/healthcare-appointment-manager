# API contract

Status: Phase 0 implementation contract. This document is the agreed contract for
backend implementation and frontend mocks; it does not claim that an OpenAPI document
or generated client exists yet. FastAPI schemas will become the executable source, and
the committed OpenAPI document will later generate `packages/api-client` with Orval.

Domain behavior is defined in [DOMAIN_RULES.md](./DOMAIN_RULES.md). Endpoint names below
cite those rules where the behavior is easy to misinterpret.

## Protocol and representation

- Base path: `/api/v1`.
- HTTPS is required outside isolated local development.
- Request and response bodies use `application/json` and UTF-8. File upload is outside
  the Phase 0 contract.
- Field names use `snake_case`. Resource IDs are opaque UUID strings.
- Instants use RFC 3339 with an explicit offset; canonical responses use UTC `Z`.
  Calendar dates use `YYYY-MM-DD`, local times use `HH:MM[:SS]`, and time zones use IANA
  names such as `Asia/Kolkata`.
- Missing optional fields and explicit `null` are distinct. Schemas state which fields
  are nullable. Unknown request fields are rejected.
- Collection endpoints return `{ "items": [...], "next_cursor": "..." }`.
  `next_cursor` is `null` on the final page. Cursors are opaque and filters/order remain
  stable for the life of a traversal.
- Successful creates return `201`; reads and ordinary commands return `200`; commands
  with no body return `204`. The API does not redirect between slash variants.
- Every response includes `X-Request-ID`. A caller may send a valid
  `X-Request-ID`; otherwise the API creates one. This identifier contains no PHI.

### Common resource fields

Mutable resource responses include:

```json
{
  "id": "9fe2e49a-0f29-4f02-b0ed-90ef435a6b54",
  "version": 3,
  "created_at": "2026-08-24T08:30:00Z",
  "updated_at": "2026-08-24T09:00:00Z"
}
```

Write requests that update mutable state send `expected_version`. Server-managed fields
such as IDs, versions, audit actors, and timestamps are rejected when supplied where
the operation does not explicitly accept them.

## Authentication, authorization, and data minimization

All endpoints except `GET /health/live` and `GET /health/ready` require
`Authorization: Bearer <Supabase access token>`. The API verifies signature, issuer,
audience, expiry, and the application profile before authorization. Tokens are never
accepted in URLs or response bodies.

Roles are `patient`, `doctor`, and `admin`. Each endpoint below states its allowed roles;
the server also enforces ownership/assignment from `AUTH-001` through `AUTH-004`.
`401 AUTHENTICATION_REQUIRED` covers an absent or invalid credential. A valid identity
without permission receives `403 FORBIDDEN`. For patient-owned or doctor-assigned
resources, the service may return `404 RESOURCE_NOT_FOUND` instead of confirming an
unrelated resource exists.

Responses are purpose-specific views, not database row dumps. Collections, dashboards,
audit data, outbox status, logs, notifications, and calendar/email/LLM payloads exclude
symptoms, clinical notes, prescriptions, contact data, and other PHI unless the endpoint
and caller require those exact fields. Clinical text is never placed in URLs or error
details. Development examples and frontend fixtures use synthetic identities and text.

## Error envelope

Every non-2xx JSON response uses this shape:

```json
{
  "error": {
    "code": "SLOT_CONFLICT",
    "message": "The selected time is no longer available.",
    "fields": [
      { "path": "starts_at", "code": "unavailable", "message": "Choose another time." }
    ],
    "retryable": false,
    "details": { "doctor_id": "2f85498b-0f9f-4d5b-826f-90b89358267f" }
  },
  "request_id": "01J61H82M9P1D7ZVT2D6R2YV49"
}
```

`code` is stable and machine-readable; `message` is safe for display but may be
localized later. `fields` is present only for field errors, uses request-field paths,
and never echoes submitted clinical text. `details` is optional, bounded,
machine-readable, and contains no secrets or PHI. Clients must branch on `code`, not
message text.

| HTTP | Stable codes | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed JSON, cursor, header, or command |
| 401 | `AUTHENTICATION_REQUIRED` | Missing, expired, or invalid token |
| 403 | `FORBIDDEN` | Role or resource policy denies the action |
| 404 | `RESOURCE_NOT_FOUND` | Resource absent or concealed by ownership policy |
| 409 | `SLOT_CONFLICT`, `HOLD_EXPIRED`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `LEAVE_PREVIEW_STALE` | Current state prevents the command |
| 422 | `VALIDATION_FAILED` | Structurally valid JSON violates field constraints |
| 429 | `RATE_LIMITED` | Retry after the response's `Retry-After` value |
| 500 | `INTERNAL_ERROR` | Unexpected failure; no internal detail is disclosed |
| 503 | `DEPENDENCY_UNAVAILABLE` | A required synchronous dependency is unavailable |

External email, calendar, worker, or LLM failures after a domain commit are represented
on integration/generation status resources, not as a failed booking or visit response.

## Idempotency and concurrency

Commands marked **Idempotent** require an `Idempotency-Key` header with an opaque value
of 16–128 visible ASCII characters. Clients generate a random value per user intent and
never embed PHI. Scope, fingerprint, serialization, and replay follow `IDEM-001` and
`IDEM-002`. The first completed HTTP status and JSON body are replayed. The service
documents and exposes its key-retention window in OpenAPI; clients may not assume replay
after that window.

Commands marked **Versioned** require `expected_version` in the JSON body and follow
`CONC-001`. `409 VERSION_CONFLICT` returns safe `details` containing `current_version`.
ETags may be added later but are not part of Phase 0.

Booking and hold correctness still relies on the PostgreSQL conflict constraint. A
successful availability read or matching resource version does not guarantee that a
later write will win (`BOOK-001`, `BOOK-002`, `BOOK-006`).

## Resource views for frontend mocks

The executable schemas may split these into summary/detail models, but must preserve
these semantics:

- `UserContext`: `subject_id`, active `role`, `available_roles`, and role-specific
  profile ID; no token claims are echoed.
- `DoctorSummary`: `id`, display name, credentials, specialization labels, avatar URL
  if approved, and next available instant. `DoctorDetail` adds public biography,
  accepted appointment durations, time zone, and public working-hours view.
- `AvailabilitySlot`: `doctor_id`, `starts_at`, `ends_at`, and `available`; it is
  advisory and carries no patient data.
- `Hold`: common fields plus `patient_id`, `doctor_id`, `starts_at`, `ends_at`,
  `status` (`active|released|expired|converted`), and `expires_at`.
- `AppointmentSummary`: common fields plus patient/doctor minimum display references,
  interval, `status` (`confirmed|in_progress|completed|cancelled_patient|cancelled_doctor|cancelled_admin|cancelled_doctor_leave`), and integration-status summary.
  Patient-facing lists do not expose internal notes; doctor lists contain only the
  symptom brief needed for the assigned appointment.
- `AppointmentDetail`: summary fields plus authorized original symptoms, generated
  brief status/content when permitted, cancellation/reschedule metadata, and visit link.
- `Visit`: common fields plus `appointment_id`, original doctor-note record/version,
  generated artifact status, `status` (`draft|completed`), and prescription.
- `Prescription`: common fields plus `visit_id` and ordered structured items. An item
  contains `id`, medication display name, dosage, route if applicable, frequency,
  `start_date`, optional `end_date`/duration, and patient instructions (`RX-001`).
- `IntegrationStatus`: channel (`email|calendar|llm|appointment_reminder|medication_reminder`),
  state (`pending|succeeded|retrying|failed`), last attempt time, attempt count, and a
  safe error code; provider payloads and secrets are excluded.

## Endpoint inventory

This inventory is sufficient to build typed frontend fixtures. Exact request/response
schema component names and enums must be frozen in FastAPI before generating the client.

### Session and patient profile

| Method and path | Roles | Contract |
|---|---|---|
| `GET /me` | all | Return `UserContext` for the active subject and role. |
| `GET /me/profile` | patient | Return the caller's patient profile and reminder time-zone preferences. |
| `PATCH /me/profile` | patient | **Versioned.** Update allowlisted profile/preferences fields; contact identity changes remain with the auth provider. |

### Doctor discovery, administration, and schedules

| Method and path | Roles | Contract |
|---|---|---|
| `GET /doctors` | patient, doctor, admin | Cursor-search public doctor summaries by text, specialization, and active state. Patient responses never include private contact or schedule-rule data. |
| `GET /doctors/{doctor_id}` | patient, doctor, admin | Return the role-appropriate doctor detail view. |
| `POST /doctors` | admin | **Idempotent.** Provision an application doctor profile for an existing approved auth subject. |
| `PATCH /doctors/{doctor_id}` | admin | **Versioned.** Update allowlisted profile/status fields. Disabling a doctor with future appointments requires a separate operational resolution. |
| `GET /doctors/{doctor_id}/working-hours` | assigned doctor, admin | Return recurring schedule intervals, appointment durations, time zone, and version. |
| `PUT /doctors/{doctor_id}/working-hours` | assigned doctor, admin | **Versioned.** Replace validated working-hours rules; conflicting future appointments require explicit handling rather than silent cancellation. |
| `GET /doctors/{doctor_id}/availability?from=&to=&duration_minutes=` | patient, assigned doctor, admin | Return advisory slots in the requested bounded range; output instants are UTC. |

### Holds and appointments

| Method and path | Roles | Contract |
|---|---|---|
| `POST /holds` | patient | **Idempotent.** Request `doctor_id`, `starts_at`, and `duration_minutes`; atomically create an active hold or return `SLOT_CONFLICT` (`BOOK-002`, `HOLD-001`). |
| `GET /holds/{hold_id}` | owning patient | Return current server-derived state and `expires_at`. |
| `DELETE /holds/{hold_id}` | owning patient | **Idempotent.** Release an active hold; returns `204` when the same release intent is replayed. |
| `POST /holds/{hold_id}/confirm` | owning patient | **Idempotent.** Submit original `symptoms_text`; atomically convert the hold, create the confirmed appointment and outbox events, and return `201 AppointmentDetail` (`BOOK-004`, `TEXT-001`). |
| `GET /appointments` | all | Cursor-list role-scoped appointments filtered by status and bounded date range. Patient sees own, doctor sees assigned, admin sees operational summaries without clinical text. |
| `GET /appointments/{appointment_id}` | owning patient, assigned doctor, admin operational view | Return the role-appropriate appointment detail. Admin clinical fields remain excluded by default. |
| `POST /appointments/{appointment_id}/cancel` | owning patient, assigned doctor, admin | **Idempotent, Versioned.** Cancel with an allowlisted reason code and optional safe note; emit outbox events. |
| `POST /appointments/{appointment_id}/reschedule` | owning patient, assigned doctor, admin | **Idempotent, Versioned.** Request a new interval and atomically retain the audit history or return `SLOT_CONFLICT`. |

### Leave management

| Method and path | Roles | Contract |
|---|---|---|
| `GET /doctors/{doctor_id}/leave` | assigned doctor, admin | Cursor-list leave intervals; only administrators mutate leave. |
| `POST /doctors/{doctor_id}/leave/preview` | admin | Validate a proposed UTC interval/reason and return a short-lived `preview_token`, doctor schedule version, affected hold count, and affected appointment summaries. No mutation occurs. |
| `POST /doctors/{doctor_id}/leave` | admin | **Idempotent, Versioned.** Apply a preview token; atomically invalidate affected holds, cancel every overlapping confirmed appointment as `cancelled_doctor_leave`, and enqueue required notifications/calendar cancellations (`LEAVE-002`, `LEAVE-003`). |
| `POST /doctors/{doctor_id}/leave/{leave_id}/preview` | admin | Preview a versioned edit or removal and its impact. |
| `PATCH /doctors/{doctor_id}/leave/{leave_id}` | admin | **Idempotent, Versioned.** Apply the matching preview and the same mandatory affected-appointment handling. |
| `DELETE /doctors/{doctor_id}/leave/{leave_id}` | admin | **Idempotent, Versioned.** Remove leave using a matching preview token; no unrelated appointment state changes. |

### Symptoms, generated briefs, visits, and prescriptions

| Method and path | Roles | Contract |
|---|---|---|
| `GET /appointments/{appointment_id}/symptoms` | owning patient, assigned doctor | Return immutable original symptom versions plus separately labeled generated-brief status when authorized. |
| `GET /appointments/{appointment_id}/visit` | owning patient after completion, assigned doctor | Return patient-safe completed view or doctor draft/detail view. Patient access follows publication/completion policy. |
| `POST /appointments/{appointment_id}/visit` | assigned doctor | **Idempotent.** Open the one draft visit for a confirmed or in-progress appointment; replay returns that visit. |
| `PATCH /visits/{visit_id}` | assigned doctor | **Versioned.** Append a new original-note version and replace the draft structured prescription as one validated change; never overwrite prior source text. |
| `POST /visits/{visit_id}/complete` | assigned doctor | **Idempotent, Versioned.** Validate and atomically finalize notes/prescription and complete the appointment (`VISIT-002`). External work continues asynchronously. |
| `POST /visits/{visit_id}/amendments` | assigned doctor | **Idempotent, Versioned.** Append a reasoned correction to a completed visit; do not mutate historical content. |

Generated briefs are created asynchronously from appointment/visit events. Phase 0 does
not expose a general-purpose prompt endpoint. The detail resources expose generation
state so the UI can render `pending`, `succeeded`, or graceful-degradation states while
always showing original text (`LLM-001` through `LLM-003`).

### Medication reminders

| Method and path | Roles | Contract |
|---|---|---|
| `GET /prescriptions/{prescription_id}/reminder-schedule` | owning patient, prescribing doctor | Return a bounded preview of occurrences derived from structured fields and patient time zone; no prose is parsed. |
| `GET /me/reminder-preferences` | patient | Return medication channel, consent/enabled state, local times, time zone, and version. |
| `PUT /me/reminder-preferences` | patient | **Versioned.** Replace preferences and enqueue deterministic schedule reconciliation. |

### Integration health and retries

| Method and path | Roles | Contract |
|---|---|---|
| `GET /appointments/{appointment_id}/integrations` | owning patient (safe subset), assigned doctor, admin | Return channel states without provider payloads, tokens, or clinical text. |
| `GET /admin/integrations` | admin | Cursor-list safe operational status filtered by channel/state/time; identifiers and error codes only. |
| `POST /admin/integrations/{operation_id}/retry` | admin | **Idempotent, Versioned.** Retry one terminally failed operation; reject pending/succeeded work with `INVALID_STATE_TRANSITION`. |

### Health

| Method and path | Roles | Contract |
|---|---|---|
| `GET /health/live` | public | Process liveness only; no dependency details, environment values, or build secrets. |
| `GET /health/ready` | public | Coarse readiness (`ok` or unavailable) without hostnames, credentials, patient data, or internal exception text. |

## OpenAPI and generated-client gate

Before replacing frontend mocks, the integration owner must:

1. Implement explicit Pydantic v2 request and response models for every shipped route;
   no untyped dictionaries or database models are exposed.
2. Assign stable `operationId` values, schema names, tags, documented auth, status codes,
   error envelopes, idempotency headers, and examples containing synthetic data only.
3. Export and commit the FastAPI OpenAPI artifact from the canonical implementation,
   validate it, and generate `packages/api-client` with the pinned Orval command.
4. Treat generated files as output: frontend and backend workers do not hand-edit them.
5. Run a contract diff for breaking changes. Removing/renaming fields or enum values,
   tightening accepted input, or changing authorization/semantics requires an explicit
   versioned contract decision.

Until that gate is complete, frontend fixtures should model the views and states in this
document, including loading, empty, `SLOT_CONFLICT`, `HOLD_EXPIRED`, `VERSION_CONFLICT`,
integration retry/failure, and LLM-unavailable states. Fixtures must be synthetic and
must not be presented as generated-client output.
