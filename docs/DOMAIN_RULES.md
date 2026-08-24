# Domain rules

Status: Phase 0 implementation contract.

These identifiers are stable. Application code, database constraints, API descriptions,
tests, and frontend fixtures should cite them. A change to a rule is a cross-team
contract change and requires supervisor review.

## Terms and identities

- Every persisted resource has an opaque, immutable UUID exposed as a string. IDs are
  never derived from names, email addresses, calendar event IDs, or other personal data.
- A **patient**, **doctor**, and **administrator** are application profiles associated
  with a Supabase Auth subject. One subject may have only the roles explicitly assigned
  by an administrator.
- An appointment interval is half-open: `[starts_at, ends_at)`. Adjacent appointments do
  not overlap.
- A **hold** is a short-lived reservation made while a patient completes booking. A
  **booking** is an appointment committed after the hold is confirmed.
- External email, calendar, and LLM systems are projections of application state. They
  never own clinical or scheduling truth.

## Booking and slot ownership

**BOOK-001 — Database authority.** PostgreSQL is the sole authority for slot ownership.
Redis, a worker queue, an in-memory availability calculation, and a calendar provider
may accelerate or project state but may not decide whether an interval is free.

**BOOK-002 — Effective overlap.** For the same doctor, a non-expired `active` hold or an
appointment in `scheduled` or `completed` state conflicts with every interval for which
`candidate.starts_at < existing.ends_at` and
`candidate.ends_at > existing.starts_at`. `cancelled` appointments and `expired`,
`released`, or `converted` holds do not conflict. The database must enforce this rule
under concurrent writes; a read-before-write availability check alone is insufficient.

**BOOK-003 — Schedule validation.** A hold may be created only when the entire requested
interval falls within one configured doctor working-hours interval and outside all
doctor leave intervals. The duration must be one of the configured appointment
durations. The server revalidates these conditions when converting the hold.

**BOOK-004 — Atomic confirmation.** Converting an active hold creates exactly one
appointment, marks the hold `converted`, records the booking idempotency result, and
creates required outbox events in one database transaction. A failed transaction makes
none of those changes visible.

**BOOK-005 — State transitions.** An appointment begins as `scheduled`. Allowed terminal
transitions are `scheduled -> cancelled` and `scheduled -> completed`. Rescheduling is
an atomic replacement that locks the original appointment, validates the new interval,
updates it, and emits one reschedule event; the previous interval is retained in audit
data. Terminal appointments cannot be rescheduled or transitioned again.

**BOOK-006 — Availability is advisory.** Availability responses are snapshots and do
not reserve a slot. Clients must handle a confirmation conflict by refreshing
availability without treating it as a server failure.

## Holds and retry safety

**HOLD-001 — Hold lifetime.** The server assigns `expires_at` when it creates a hold;
clients cannot choose or extend it. The configured lifetime must be documented and
consistent for all clients. UI countdowns use `expires_at` but server/database time is
authoritative.

**HOLD-002 — Expiry.** A hold is usable only while its state is `active` and database
time is strictly before `expires_at`. Expired holds cease to block booking even if an
asynchronous cleanup job has not yet changed their stored state to `expired`.

**HOLD-003 — Ownership and lifecycle.** Only the patient that owns a hold can read,
release, or confirm it. A hold can convert at most once. Releasing, expiring, or
converting a hold is idempotent for the same request intent, and no path may convert a
released or expired hold.

**IDEM-001 — Mutation keys.** Hold creation, hold confirmation, cancellation,
rescheduling, visit completion, and integration retry accept an `Idempotency-Key`.
Keys are scoped to authenticated subject, HTTP method, and route template. The service
stores a request fingerprint and the completed status/body for the documented retention
period.

**IDEM-002 — Replay behavior.** Reusing a key with the same canonical request returns
the first completed outcome and does not repeat side effects. Reusing it with a
different request returns `409 IDEMPOTENCY_KEY_REUSED`. Two in-flight uses of the same
key are serialized; a client never receives two successful resources.

**CONC-001 — Optimistic concurrency.** Mutable resources expose an integer `version`.
Update commands include the last observed version. A stale version returns
`409 VERSION_CONFLICT` and does not partially apply the mutation.

## Working hours and leave

**LEAVE-001 — Interval rules.** Working hours and leave use half-open intervals. Doctor
working hours are recurring local wall-clock intervals in the doctor's IANA time zone;
leave is stored as concrete UTC instants after resolving local date/time input.

**LEAVE-002 — Impact preview.** Creating or changing leave first requires a server-side
impact preview listing affected active holds and scheduled appointments. Applying leave
requires the preview token and expected doctor schedule version; an expired or stale
preview returns a conflict and must be regenerated.

**LEAVE-003 — Explicit resolution.** Leave application invalidates overlapping active
holds atomically. It never silently cancels scheduled appointments. The request must
choose an explicit resolution for each affected appointment: cancel with a reason, or
leave scheduled with an acknowledged exception. The result and actor are audited, and
notifications are emitted through the outbox.

## Outbox and integrations

**OUTBOX-001 — Transactional intent.** Any committed change requiring email, calendar
sync, an LLM task, or reminders writes an immutable outbox event in the same transaction
as the domain change. Domain success never depends on the external call succeeding.

**OUTBOX-002 — At-least-once delivery.** Workers may process an event more than once.
Every consumer uses the event UUID or a stable derived operation key to make external
effects idempotent. Events record attempts, next-attempt time, and a terminal/dead-letter
state without storing access tokens or unnecessary clinical text.

**OUTBOX-003 — Observable degradation.** Integration state is exposed separately as
`pending`, `succeeded`, `retrying`, or `failed`. Retrying or failed projection never
rolls back an appointment, visit, or prescription. Authorized users can retry only
terminally failed operations; retry creates or requeues one idempotent delivery intent.

**OUTBOX-004 — Calendar privacy.** Calendar event payloads use the minimum necessary
identity and scheduling data. Symptoms, notes, prescriptions, diagnoses, and generated
summaries are excluded from event titles, descriptions, logs, and provider metadata.

## Symptoms, visits, LLM output, and prescriptions

**TEXT-001 — Preserve originals.** Patient symptom text and doctor-authored visit notes
are immutable original-text records. Normalization, redaction, summarization, or later
editing creates a separate version linked to the original; it never overwrites the
submitted text. Access to all versions follows the stricter clinical-data policy.

**LLM-001 — Optional assistance.** LLM output is advisory, is visibly labeled as
generated, and cannot diagnose, book, cancel, complete a visit, prescribe medication,
or alter original text. The provider receives only the minimum fields required for the
approved task.

**LLM-002 — Graceful degradation.** LLM timeout, refusal, invalid structured output, or
provider failure records a separate failed/retryable summary state. It cannot prevent
appointment confirmation, opening the doctor workspace, saving original notes, or
completing a visit. The UI must continue with the original text.

**LLM-003 — Provenance.** A generated artifact records its source-record versions,
task/schema version, provider/model identifier, creation time, and status. Generated
content is never silently treated as doctor-authored content.

**VISIT-001 — Visit ownership.** A visit belongs to exactly one appointment and can be
created or edited only by the assigned doctor (or an administrator performing an
explicitly audited support action). Only a scheduled appointment can be opened for a
visit; completion atomically finalizes notes/prescriptions and transitions the
appointment to `completed`.

**VISIT-002 — Completion validation.** Completion requires the latest visit version and
valid structured prescription entries. A completed visit is immutable; corrections are
append-only amendments with author, timestamp, and reason.

**RX-001 — Structured prescription.** Each prescription item has a stable UUID and
stores medication display name, dosage amount/text, route when applicable, frequency,
start date, optional end date or duration, patient-facing instructions, and prescriber.
Required fields and bounded values are validated by the API. No field derived from LLM
prose is accepted as a prescription without explicit doctor review and submission.

**RX-002 — Reminder source.** Medication reminder occurrences are derived
deterministically from structured prescription fields and the patient's configured IANA
time zone. Generated prose, free-form notes, and LLM summaries are never parsed to
create reminders.

**RX-003 — Reminder lifecycle.** A prescription change cancels not-yet-sent occurrences
from the superseded version and schedules occurrences from the new version. Delivery is
idempotent, retains prescription/version provenance, and stops at the configured end.
Reminder content contains the minimum information necessary for the selected channel.

## Authorization, ownership, and PHI minimization

**AUTH-001 — Server enforcement.** The API verifies the Supabase bearer token and
enforces role and resource ownership on every request. Hiding UI controls is not an
authorization control. Unknown, disabled, or unprovisioned subjects receive no domain
access.

**AUTH-002 — Patient boundary.** Patients may access only their own profile, holds,
appointments, symptoms, visit summaries made available to them, prescriptions, and
reminder preferences. Patient list/search endpoints never reveal another patient's
existence or data.

**AUTH-003 — Doctor boundary.** Doctors may access their own schedule and leave and the
minimum patient/clinical data for appointments assigned to them. Assignment is checked
at request time. Doctors cannot manage another doctor's schedule or browse unrelated
patients.

**AUTH-004 — Administrator boundary.** Administrators manage doctors, schedules, leave,
appointment operations, and integration health. Clinical-text access is not granted by
the administrator role by default; any support-access exception must be separately
authorized, reasoned, time-bounded, and audited.

**DATA-001 — Minimum necessary data.** List, search, notification, log, metric, audit,
and integration payloads contain only fields needed for their purpose. Secrets and PHI
are never placed in URLs, idempotency keys, queue names, exception messages, analytics,
or free-form logs. Synthetic data is used for development and demos.

## Time and auditability

**TIME-001 — Wire and storage format.** Instants are stored in UTC and serialized as
RFC 3339 timestamps with an explicit offset (canonical API output uses `Z`). Date-only
prescription fields remain ISO 8601 calendar dates. APIs reject offset-free instants.

**TIME-002 — Local-time context.** Doctor schedules and medication reminder preferences
carry an IANA time-zone name. The server resolves daylight-saving gaps and folds using
a documented policy and returns the resolved instant and zone. Clients format instants
for display but do not calculate booking validity.

**TIME-003 — Server clock.** Expiry, audit timestamps, retry timing, and transition
ordering use server/database time. Client clocks are informational only.

**AUDIT-001 — Security and clinical trail.** Privileged or clinical mutations append an
audit record containing event UUID, actor subject/profile and role, action, resource
type/UUID, timestamp, request correlation ID, result, and structured reason where
required. Audit records are immutable and must not duplicate full symptom, note, or
prescription bodies.

**AUDIT-002 — Traceability.** Every API response has a request ID. Domain events,
outbox attempts, worker logs, and generated artifacts retain correlation identifiers so
an authorized operator can trace a workflow without exposing PHI in general logs.
