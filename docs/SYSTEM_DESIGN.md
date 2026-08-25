# System-design submission

The system treats PostgreSQL as the only authority for scheduling truth. Availability is a
read-only snapshot: it helps a patient choose a time but never reserves one. A booking
interval is half-open, `[starts_at, ends_at)`, so adjacent appointments are valid while
any real overlap is a conflict.

When a patient asks for a slot, the API authenticates the actor, validates the doctor's
working-hours interval, time zone, configured duration, and leave, then locks the
doctor's booking lane inside a PostgreSQL transaction. The slot hold has a
server/database-issued `expires_at`, not a client-selected duration. An active hold is
stored with a generated `tstzrange` and a GiST exclusion constraint for the doctor;
expired, released, and converted holds no longer participate in ownership. Twenty
concurrent contenders therefore serialize at the database boundary: one inserts the
active hold and the rest receive a stable `SLOT_CONFLICT`. A hold confirmation locks
the hold and doctor again, revalidates expiry, schedule, leave, and appointment overlap,
then inserts the appointment, converts the hold, writes required outbox rows, and appends
an audit event in one commit. A failure rolls back every mutation. Idempotency records
replay the first completed result for the same actor, route, key, and request
fingerprint, preventing retries from creating a second appointment.

Doctor leave is an explicit operational workflow rather than a hidden availability
toggle. The administrator first requests a short-lived impact preview containing the
doctor schedule version, affected active holds, and overlapping confirmed appointments.
Applying leave requires that preview and expected version. The transaction locks the
doctor's booking lane, invalidates every affected active hold, changes every overlapping
confirmed appointment to `cancelled_doctor_leave`, records the actor/reason, and emits
one patient-notification and calendar-cancellation intent per affected appointment.
Appointments outside the interval remain unchanged. A stale preview or schedule version
returns a conflict and causes no partial change. Availability generation and direct hold
creation apply the same leave intervals, so a future slot cannot be acquired while
leave is active.

Notifications, Calendar projections, reminders, and LLM summaries are asynchronous
projections. The domain transaction creates an immutable PostgreSQL outbox event with a
stable deduplication key. The durable worker poller claims events at least once with
`FOR UPDATE SKIP LOCKED`, leases, fencing, bounded concurrency, and retry state; Redis/
Celery may transport notifications but never owns the work. The event UUID is the
provider idempotency key when supported. Transient network, rate-limit, or provider
errors receive bounded exponential backoff with jitter. Permanent validation or
authorization errors become terminal and remain visible for an authorized retry.
Redelivery after success is deduplicated and cannot send a second logical message or
create a second Calendar event.

A SendGrid, Calendar, Redis, or LLM outage therefore leaves a committed appointment,
visit, or prescription valid. The API exposes integration state separately as pending,
retrying, succeeded, or failed, while the UI preserves original symptoms and
doctor-authored notes. LLM output is optional, schema-validated, versioned, and labeled
generated; structured prescription fields—not generated prose—drive medication
reminders. This separation keeps booking correctness transactional and makes external
failure observable and recoverable without corrupting clinical or scheduling truth.

Word count: 498 (excluding the title and this line; whitespace-token count).
