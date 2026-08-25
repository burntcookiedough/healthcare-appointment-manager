# API guide

This guide describes the executable FastAPI surface in the current source. The
implementation is no longer a booking-only/Phase 1 stub: migration `0002` and the
application-domain router expose profiles, doctors, schedules, leave, appointments,
clinical visits, reminders, and integration status. The route list below is derived from
`apps/api/src/healthcare_api/routers`; the runtime OpenAPI document remains the final
wire-contract authority.

## Base protocol and authentication

- Base path: `/api/v1`; JSON fields use `snake_case`; IDs are opaque UUIDs.
- Instants require an RFC 3339 offset and responses serialize UTC as `Z`.
- Every response carries `X-Request-ID`; the JSON error envelope repeats it as
  `request_id` without PHI.
- `GET /health/live` and `GET /health/ready` are public. Other routes require a
  Supabase-compatible bearer token mapped to an active `actors` row.
- The API verifies JWT signature, issuer, audience, expiry, and optional `nbf`. Hosted
  deployments should use `SUPABASE_JWT_PUBLIC_KEY`, `SUPABASE_JWT_ISSUER`, and
  `SUPABASE_JWT_AUDIENCE`; `SUPABASE_JWT_SECRET` is only an explicit HS256 alternative.
- `test:<subject>` local tokens are accepted only when `AUTH_ALLOW_LOCAL_TEST_TOKENS=true`
  and `APP_ENV` is local/development/test. Render sets the flag to `false`.
- Mutating hold, leave, appointment, visit, and integration-retry routes require an
  `Idempotency-Key` header with 16–128 visible ASCII characters. Versioned updates carry
  `expected_version` (leave apply uses `expected_version` for the doctor schedule).

The server enforces role and ownership; a browser role selector, URL, or guessed UUID is
not authorization. Unrelated patient/doctor resources are concealed or denied without
clinical data disclosure.

## Executable route inventory

Every route in this table is mounted by `create_app()` and backed by the current
router/service code; focused contract/domain tests exercise the behavior. “Owner” means
an additional resource check applies after role authorization.

| Method | Path | Roles | Behavior |
| --- | --- | --- | --- |
| GET | `/health/live` | public | Process liveness; no dependency call. |
| GET | `/health/ready` | public | Bounded PostgreSQL `SELECT 1`; unavailable returns `503`. |
| GET | `/me` | patient, doctor, admin | Verified subject, active role, and profile ID. |
| GET/PATCH | `/me/profile` | patient | Read/update own display name/timezone with version check. |
| GET | `/doctors` | patient, doctor, admin | Search active/public doctors. |
| GET | `/doctors/{doctor_id}` | patient, doctor, admin | Doctor detail; inactive detail is admin-only. |
| POST/PATCH | `/doctors`, `/doctors/{doctor_id}` | admin | Provision/update doctor profiles; create is idempotent. |
| GET/PUT | `/doctors/{doctor_id}/working-hours` | doctor (owner), admin | Read/replace schedule and durations with version check. |
| GET | `/doctors/{doctor_id}/leave` | doctor (owner), admin | List leave intervals. |
| POST | `/doctors/{doctor_id}/leave/preview` | admin | Create short-lived impact preview. |
| POST | `/doctors/{doctor_id}/leave` | admin | Apply preview atomically; cancels affected appointments and emits work. |
| POST | `/doctors/{doctor_id}/leave/{leave_id}/preview` | admin | Preview an edit/removal impact from current rows. |
| PATCH | `/doctors/{doctor_id}/leave/{leave_id}` | admin | Apply a versioned leave edit with idempotency checks. |
| DELETE | `/doctors/{doctor_id}/leave/{leave_id}` | admin | Remove leave with idempotency/version checks. |
| GET | `/doctors/{doctor_id}/availability` | patient, doctor (owner), admin | Advisory slots for an aware bounded range and configured duration. |
| POST | `/holds` | patient | Create a server-expiring hold or return `409 SLOT_CONFLICT`. |
| GET/DELETE | `/holds/{hold_id}` | patient (owner) | Inspect/expire or idempotently release an owned hold. DELETE is `204`. |
| POST | `/holds/{hold_id}/confirm` | patient (owner) | Atomically create appointment, convert hold, and write outbox/audit rows. |
| GET | `/appointments` | patient, doctor, admin | Role-filtered appointment summaries with optional status/time filters. |
| GET | `/appointments/{appointment_id}` | patient, doctor, admin | Authorized detail, original symptoms only where permitted. |
| POST | `/appointments/{appointment_id}/cancel` | patient, doctor, admin | Authorized versioned cancellation with reason. |
| POST | `/appointments/{appointment_id}/reschedule` | patient, doctor, admin | Atomic versioned interval change with conflict checks and history. |
| GET/POST | `/appointments/{appointment_id}/symptoms` | patient/doctor; patient writes | Read versions or append patient symptom source; originals remain preserved. |
| GET/POST | `/appointments/{appointment_id}/visit` | patient/doctor; doctor opens | Read or open the assigned appointment visit. |
| PATCH | `/visits/{visit_id}` | doctor | Save a draft note/prescription with optimistic versioning. |
| POST | `/visits/{visit_id}/complete` | doctor | Complete visit atomically and enqueue derived work. |
| POST | `/visits/{visit_id}/amendments` | doctor | Append an audited correction to a completed visit. |
| GET/PUT | `/me/reminder-preferences` | patient | Read/update own channel/timezone/local-time preferences. |
| GET | `/prescriptions/{prescription_id}/reminder-schedule` | patient, doctor | Read deterministic occurrences derived from structured items. |
| GET | `/appointments/{appointment_id}/integrations` | patient, doctor, admin | Authorized per-appointment integration states only. |
| GET | `/admin/integrations` | admin | Filter operational integration rows by state/channel. |
| POST | `/admin/integrations/{operation_id}/retry` | admin | Idempotently retry an authorized terminal integration operation. |

FastAPI publishes interactive docs at `/api/v1/docs`, ReDoc at `/api/v1/redoc`, and the
runtime OpenAPI JSON at `/api/v1/openapi.json` while the API is running. There is no
committed OpenAPI artifact or generated Orval client yet.

## Booking and clinical invariants

Availability is a snapshot, never ownership. A hold receives a database/server expiry;
the client cannot extend it. PostgreSQL range exclusion and transactional locks prevent
overlap under concurrency. Confirmation commits the appointment, converted hold, audit
event, and required outbox work together. External email, Calendar, Redis, or LLM failure
changes only integration/derived-output state and cannot invalidate the appointment.
Original patient symptoms and doctor notes are retained as source versions. Reminder
timing comes only from structured prescription fields, never generated prose.

## Error envelope

Every non-2xx JSON response uses:

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

Stable implementation codes include `AUTHENTICATION_REQUIRED`, `FORBIDDEN`,
`RESOURCE_NOT_FOUND`, `INVALID_REQUEST`, `VALIDATION_FAILED`, `SLOT_CONFLICT`,
`HOLD_EXPIRED`, `INVALID_STATE_TRANSITION`, `VERSION_CONFLICT`,
`IDEMPOTENCY_KEY_REUSED`, `LEAVE_PREVIEW_STALE`, `INTERNAL_ERROR`, and
`DEPENDENCY_UNAVAILABLE`. Clients branch on `error.code`, not display text, and must not
echo clinical input in an error.

## Frontend/API integration

`apps/web/src/lib/api/client.ts` is the current typed data-access boundary. With an API
URL and `NEXT_PUBLIC_DEMO_MODE=false`, it sends Supabase bearer tokens to `/api/v1`,
generates idempotency keys, refreshes an expired session once, and surfaces the API error
envelope. With `NEXT_PUBLIC_DEMO_MODE=true`, it uses deterministic in-memory fixtures for
offline/demo scenarios; it never pretends those records are hosted data. The production
role is derived from `GET /me`, not a UI role switcher.

`packages/api-client` is still a placeholder because no reviewed OpenAPI artifact has
been committed. Before enabling a hosted frontend, start the API at the exact release
commit, review `/api/v1/openapi.json`, validate operation IDs/statuses/ownership/error
schemas, generate the pinned client, and reconcile the web adapter's request/response
shapes in one contract-reviewed change. Do not claim generated-client parity from mocks.

## OpenAPI handoff

1. Run migrations through `head`, start FastAPI with the intended environment, and fetch
   `/api/v1/openapi.json`.
2. Review auth dependencies, role/ownership views, status codes, idempotency headers,
   error schemas, examples, and PHI-minimized response fields.
3. Validate the JSON and perform a breaking-change diff against the accepted artifact.
4. Generate `packages/api-client` from that reviewed document; never hand-edit generated
   output. Update web HTTP adapters and mocks only after contract tests pass.
5. Record the source commit and OpenAPI checksum in submission evidence.
