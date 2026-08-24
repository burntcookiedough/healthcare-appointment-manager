# API guide

This guide separates the executable Phase 1 FastAPI surface from the broader frozen
contract in [`API_CONTRACT.md`](API_CONTRACT.md). It is intentionally explicit about
what a local process can serve today. Do not build a client against a contract-only
route until the concurrent API completion lane has added the route, tests, and reviewed
OpenAPI artifact.

## Base protocol

- Base path: `/api/v1`.
- JSON request/response bodies use `snake_case`.
- Resource IDs are opaque UUIDs.
- Instants require an explicit RFC 3339 offset; responses serialize UTC as `Z`.
- Every response has `X-Request-ID`; the JSON error envelope repeats it as
  `request_id`.
- Mutating hold routes require `Idempotency-Key` with 16–128 visible ASCII characters.
  A key is scoped to the authenticated actor, method, and route template. Reuse the
  same key only for the same user intent.

The current default actor dependency treats the bearer value as a local subject lookup
(and accepts the optional `test:` prefix). It does not validate a Supabase JWT yet.
The production authentication lane must replace that boundary before a hosted service
accepts real identities.

## Executable routes at this source snapshot

| Method | Path | Roles in Phase 1 | Status and behavior |
| --- | --- | --- | --- |
| GET | `/health/live` | Public | **Implemented.** Returns `{"status":"ok"}` without checking dependencies. A schema-hidden `/health/live` alias also exists for probes. |
| GET | `/health/ready` | Public | **Implemented.** Runs `SELECT 1`; returns `503 DEPENDENCY_UNAVAILABLE` when PostgreSQL is unavailable. |
| GET | `/doctors/{doctor_id}/availability?from=&to=&duration_minutes=` | patient, assigned doctor, admin | **Implemented.** Advisory UTC slots for a bounded range (maximum 31 days); it never reserves a slot. |
| POST | `/holds` | patient | **Implemented.** Validates doctor duration/schedule/leave and atomically creates a server-expiring active hold or returns `409 SLOT_CONFLICT`. |
| GET | `/holds/{hold_id}` | owning patient | **Implemented.** Returns the current hold and expires an overdue hold using database time. |
| DELETE | `/holds/{hold_id}` | owning patient | **Implemented.** Idempotently releases an active hold and returns `204`. |
| POST | `/holds/{hold_id}/confirm` | owning patient | **Implemented.** Atomically creates a confirmed appointment, converts the hold, writes appointment/calendar outbox rows, and preserves original symptoms. |
| All other paths in the inventory below | varies | **Contract-only.** | **Depends on the concurrent API completion lane.** A route is not shipped merely because it appears in `API_CONTRACT.md`. |

FastAPI's runtime documentation is available at
`http://localhost:8000/api/v1/docs`, ReDoc at `/api/v1/redoc`, and JSON at
`/api/v1/openapi.json` while the API is running. There is no committed OpenAPI file
or generated Orval client at this boundary.

## Request and response shapes

### Availability

Request query parameters:

- `from` and `to`: aware timestamps; `from < to` and the range is at most 31 days.
- `duration_minutes`: 1–480 and one of the doctor's configured durations.

Response:

```json
{
  "items": [
    {
      "doctor_id": "00000000-0000-0000-0000-000000000010",
      "starts_at": "2026-08-24T03:30:00Z",
      "ends_at": "2026-08-24T04:00:00Z",
      "available": true
    }
  ],
  "next_cursor": null
}
```

`available: true` is a snapshot, not ownership. A later hold/confirm command can
still lose a database conflict.

### Hold creation

```http
POST /api/v1/holds
Authorization: Bearer demo.patient
Idempotency-Key: demo-hold-key-0001
Content-Type: application/json

{"doctor_id":"00000000-0000-0000-0000-000000000010","starts_at":"2026-08-24T04:00:00Z","duration_minutes":30}
```

The response is `201` with `id`, `version`, patient/doctor IDs, interval,
`status: "active"`, and server-assigned `expires_at`. The client cannot choose or
extend `expires_at`.

### Hold confirmation

```http
POST /api/v1/holds/{hold_id}/confirm
Authorization: Bearer demo.patient
Idempotency-Key: demo-confirm-key-0001
Content-Type: application/json

{"symptoms_text":"Synthetic headache after exercise"}
```

A successful `201` returns the confirmed appointment, including the exact original
`symptoms_text`. The same key and canonical body replay the first result. An expired
or non-active hold returns `409 HOLD_EXPIRED` or `409 INVALID_STATE_TRANSITION`;
it does not create an appointment or outbox residue.

## Roles and ownership

| Role | Current executable behavior | Frozen contract boundary |
| --- | --- | --- |
| patient | Can view advisory availability and manage only owned holds; confirm creates their appointment. | Own profile, appointments, visit summaries made available, prescriptions, and reminders. |
| doctor | Can view only their own availability when their actor is seeded; no doctor-management or visit routes are implemented yet. | Own schedule/leave and assigned clinical workspace only. |
| admin | Can view advisory availability; no admin mutation route is implemented yet. | Doctor/schedule/leave operations and safe integration health; clinical text is excluded by default. |

The server, not the browser role selector, is the authority. A resource that belongs to
another patient/doctor may be concealed as `404 RESOURCE_NOT_FOUND` rather than
confirming its existence.

## Error envelope

Every non-2xx JSON response follows:

```json
{
  "error": {
    "code": "SLOT_CONFLICT",
    "message": "The selected time is no longer available.",
    "fields": null,
    "retryable": false,
    "details": {"doctor_id": "00000000-0000-0000-0000-000000000010"}
  },
  "request_id": "request-id-without-PHI"
}
```

Current handlers expose stable codes including `AUTHENTICATION_REQUIRED`,
`FORBIDDEN`, `RESOURCE_NOT_FOUND`, `INVALID_REQUEST`,
`VALIDATION_FAILED`, `SLOT_CONFLICT`, `HOLD_EXPIRED`,
`INVALID_STATE_TRANSITION`, `INTERNAL_ERROR`, and
`DEPENDENCY_UNAVAILABLE`. The frozen contract additionally reserves
`VERSION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `LEAVE_PREVIEW_STALE`,
`RATE_LIMITED`, and integration-specific outcomes for the completion lanes. Clients
branch on `error.code`, not display text, and must not echo clinical input in errors.

Provider or LLM failure after a domain commit is an integration/derived-output status,
not a failed appointment response.

## Frozen contract-only endpoint groups

These paths are documented for client/design alignment but are not executable until the
API completion lane lands them:

- `/me`, `/me/profile`, and profile preferences.
- Doctor search/detail/provisioning and working-hours administration.
- Appointment list/detail, cancellation, and rescheduling.
- Leave preview/apply/edit/remove with preview-token and schedule-version checks.
- Symptoms, generated briefs, visits, note versions, prescriptions, and amendments.
- Prescription reminder schedule and patient reminder preferences.
- Appointment/admin integration status and terminal-operation retry.

The exact role matrix, response views, and invariants remain in
[`API_CONTRACT.md`](API_CONTRACT.md); [`DOMAIN_RULES.md`](DOMAIN_RULES.md) is the
source for booking, leave, LLM, reminder, ownership, and audit semantics.

## OpenAPI and generated-client handoff

When the API completion lane is ready:

1. Start the API with the intended environment and fetch
   `/api/v1/openapi.json` from that exact commit.
2. Review operation IDs, tags, auth requirements, status codes, error schemas, examples,
   idempotency headers, and PHI-minimized response views.
3. Validate the JSON and run a breaking-change diff against the previously accepted
   artifact. A route appearing without tests is not an API completion.
4. Commit the reviewed artifact and run the pinned Orval generator to replace
   `packages/api-client/src/index.ts` and related generated output. Never hand-edit
   generated files.
5. Update frontend mocks only after the contract diff and role/ownership tests pass.
6. Record the source commit and OpenAPI checksum in the submission evidence.

Until then, keep using the typed mock boundary in `apps/web`; do not invent an alternate
client schema or claim the placeholder package is generated.
