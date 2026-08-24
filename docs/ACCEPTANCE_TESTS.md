# Acceptance tests

Status: Phase 0 acceptance contract.

These scenarios describe externally observable behavior. They intentionally avoid prescribing endpoint names, schema shapes, queue libraries, or UI implementation code. Later test suites may automate them at the narrowest reliable layer, but must preserve the stated preconditions, stimulus, and assertions.

## Evidence conventions

- Use synthetic patients, doctors, administrators, symptoms, notes, and prescriptions only.
- Control wall-clock time and adapter outcomes through the implementation's supported test boundaries; do not wait for real hold or retry intervals.
- Capture committed records and durable job/outbox state from a clean isolated database. Queue acknowledgements or UI messages alone are not proof of a committed outcome.
- For concurrent scenarios, synchronize requests at the booking boundary and report every outcome. A sequential loop is not concurrency evidence.
- For retry scenarios, use deterministic fake provider responses and verify the durable state before and after the retry.
- Security scenarios must verify both response behavior and absence of protected data in the response body.

## Booking and hold lifecycle

### `AT-BOOK-001` — Twenty contenders produce one booking

Domain intent: `BOOK-001`, one doctor cannot have overlapping active appointments; `BOOK-002`, PostgreSQL is authoritative for conflicts.

Given one available interval for one doctor and 20 distinct authenticated patients with valid booking input, when 20 booking attempts are released concurrently against that same interval, then exactly one appointment becomes active for the interval and the other 19 attempts receive a stable conflict outcome. No losing attempt creates an active appointment. The winning appointment and its initial outbox work are committed atomically, and retrying a losing request cannot create a second active appointment while the winner remains active.

Required evidence: synchronized concurrency trace, all 20 outcomes, active-appointment count for the doctor/interval, and committed outbox state for the winner.

### `AT-HOLD-001` — An expired hold cannot be confirmed

Domain intent: `BOOK-003`, holds expire; `BOOK-004`, expired holds cannot be confirmed.

Given a patient owns a valid hold, when controlled time advances beyond its expiry and that patient attempts confirmation, then confirmation is rejected with the stable expired-hold outcome, no appointment or booking outbox work is committed, and the interval can be offered for a new hold subject to current schedule and leave rules.

Required evidence: hold owner and expiry, controlled time, rejection outcome, absence of appointment/outbox side effects, and subsequent availability result.

### `AT-HOLD-002` — Hold ownership is enforced

Domain intent: a hold is private to its owning patient and only its owner may use it to confirm a booking.

Given patient A owns an unexpired hold, when authenticated patient B attempts to inspect or confirm it, then the request is rejected without revealing patient A's identity or symptoms and without consuming or changing the hold. Patient A can still confirm it before expiry.

Required evidence: redacted rejection for patient B, unchanged hold ownership/state, and successful owner confirmation.

### `AT-BOOK-002` — External failures do not reverse a booking

Domain intent: `BOOK-005`, calendar, email, and LLM failures cannot roll back a committed appointment.

Given a valid booking while all external adapters are configured to fail, when the booking transaction completes, then the appointment remains committed and visible with integration work represented separately as pending, retrying, failed, or unavailable. No provider error changes the appointment to failed or deletes it.

Required evidence: committed appointment, atomic initial outbox state, adapter failures, and final independent integration statuses.

## Doctor leave and transactional follow-up

### `AT-LEAVE-001` — Leave blocks availability

Domain intent: `LEAVE-001`, doctor leave blocks slot generation for the affected period.

Given a doctor has working hours and approved leave overlapping part or all of those hours, when availability is requested, then no slot overlapping the leave is offered or holdable while unaffected working time remains governed by the normal availability rules.

Required evidence: working hours, leave interval, returned availability, and a rejected direct attempt to hold an interval covered by leave.

### `AT-LEAVE-002` — Leave cancellation and notifications commit together

Domain intent: `LEAVE-002`, affected appointments become `CANCELLED_DOCTOR_LEAVE`; `LEAVE-003`, each affected appointment produces notification work.

Given a doctor has multiple confirmed appointments inside a proposed leave period plus appointments outside it, when an administrator confirms the leave, then every and only overlapping active appointment transitions to `CANCELLED_DOCTOR_LEAVE`. In the same transaction, each affected appointment receives the required durable follow-up work for patient notification and calendar cancellation; outside appointments remain unchanged.

If the transaction is forced to fail before commit, then neither the leave, cancellations, nor outbox work is visible. If an external notification later fails, the leave and cancellations remain committed and the integration follows its retry policy.

Required evidence: affected-record preview, before/after appointment sets, one durable event set per affected appointment, rollback injection result, and post-commit provider-failure result.

## LLM and clinical-source preservation

### `AT-LLM-001` — Pre-visit timeout degrades gracefully

Domain intent: `LLM-001`, an LLM failure cannot prevent booking; `LLM-002`, original symptoms are preserved.

Given a patient submits original symptoms during a valid booking and the LLM exceeds its configured timeout, when the asynchronous summary attempt finishes, then the appointment remains confirmed, summary status becomes unavailable or failed, and the exact original symptom input remains available to the authorized doctor. Generated content is not substituted for the source text.

Required evidence: confirmed appointment before and after timeout, bounded LLM attempt, summary status, and byte-for-byte or canonical lossless comparison of original symptoms.

### `AT-LLM-002` — Visit-summary failure preserves doctor input

Domain intent: `LLM-002`, original doctor notes are always preserved.

Given an authorized doctor completes visit notes and the plain-language summary adapter times out or returns an invalid result, when the visit workflow completes according to its contract, then the original notes remain intact and retrievable, generated summary content is marked unavailable rather than fabricated, and structured prescription data is unaffected.

Required evidence: original notes before/after failure, generated-summary status, and unchanged prescription fields.

## Email, calendar, and retry state

### `AT-INT-001` — SendGrid failure is retried without duplication

Domain intent: committed notification work survives transient SendGrid failure and is processed idempotently.

Given a committed notification job and a provider sequence of transient failure followed by success, when the worker processes the job and the retry becomes due, then the first failure records an incremented attempt and future retry without changing the appointment. The later success marks the notification sent exactly once. Redelivery after success does not produce a second logical email.

Required evidence: provider call sequence, durable attempt/next-retry state, unchanged appointment, sent status, and idempotent redelivery result.

### `AT-INT-002` — Calendar sync exposes failure and supports retry

Domain intent: calendar synchronization is asynchronous, durable, observable, and does not own appointment validity.

Given a committed appointment and a calendar adapter that initially fails, when synchronization runs, then the appointment remains confirmed and calendar status becomes failed or retrying with a recorded attempt. When a permitted retry later succeeds, the same logical calendar event is linked and status becomes synced without creating a duplicate event.

Required evidence: unchanged appointment, initial and final calendar statuses, attempt history, stable logical event identity, and provider event count.

## Authorization and data isolation

### `AT-RBAC-001` — Patient and doctor roles cannot use admin capabilities

Domain intent: server-side RBAC protects administrator operations regardless of client navigation.

Given authenticated patient and doctor identities, when either invokes doctor management, leave administration, or integration-health operations through a direct request, then access is denied with the stable forbidden outcome, no mutation occurs, and the response contains no protected operational data. Hiding controls in the UI is not sufficient evidence.

Required evidence: direct requests for both roles, denied responses, redacted bodies, and unchanged target records.

### `AT-RBAC-002` — A doctor cannot access another doctor's private clinical data

Domain intent: doctors are isolated to appointments and clinical records they are authorized to treat.

Given doctor A and doctor B each have distinct patients and private visit data, when doctor A requests doctor B's appointment workspace, symptoms, notes, prescription, or visit summary by guessed identifiers or list filters, then access is denied without disclosing whether the target exists. No protected field appears in direct, list, search, or error responses.

Required evidence: direct-object and collection-filter attempts, response-body inspection, and a positive control showing doctor A can access an assigned record.

### `AT-RBAC-003` — Patient records are isolated

Domain intent: a patient can access only their own appointments, holds, prescriptions, reminders, and visit summaries unless a future explicit delegation rule says otherwise.

Given patient A and patient B have distinct records, when patient A uses patient B's identifiers in direct requests or collection filters, then access is denied or the record is omitted without leaking private content or existence. Patient A's own equivalent record remains accessible.

Required evidence: direct-object and collection-filter attempts, response-body inspection, and positive own-record control.

## Prescriptions and reminders

### `AT-RX-001` — Reminder timing comes only from structured fields

Domain intent: `RX-001`, medication schedules are derived deterministically from structured prescription data, never generated prose.

Given a prescription with explicit medication, dosage, frequency, start, duration, and instructions plus generated or free-text prose that conflicts with the structured frequency, when reminders are scheduled, then reminder count and timing follow only the structured fields. Changing only generated prose does not alter the schedule; changing an authorized structured field produces the corresponding deterministic schedule update without duplicate active reminders.

Required evidence: source structured fields, conflicting prose fixture, initial reminder schedule, prose-only comparison, and structured-field update comparison.

## Frontend experience

### `AT-UI-001` — Every primary portal flow renders complete states

UI intent: patient, doctor, and admin experiences expose honest application and integration state.

For the patient booking/appointment flow, doctor appointment/visit flow, and admin leave/integration-health flow, verify controlled fixtures for initial loading, background refresh, empty, validation error, request error, offline, success, forbidden, and partial integration failure. Each state preserves valid user input where recovery is possible, provides a next action when one exists, and never represents an integration failure as a failed committed appointment.

Required evidence: route/component matrix with one capture or automated assertion per applicable state and confirmation that no raw exception, blank surface, or indefinite spinner appears.

### `AT-UI-002` — Hold countdown reflects server expiry

UI intent: the interface never overstates slot ownership.

Given a server-issued hold expiry, when the booking screen is refreshed, backgrounded and resumed, or observed until controlled time passes expiry, then the accessible countdown is derived from the expiry rather than a reset client duration. At expiry, confirmation becomes unavailable, focus or announcement communicates the change, entered symptoms remain recoverable, and the patient is directed to choose a new slot.

Required evidence: refresh/resume timing assertions, accessible-name or live-region assertion, disabled/rejected confirmation, and preserved form input.

### `AT-UI-003` — Accessibility, reflow, and reduced motion meet the handoff contract

UI intent: implemented core flows meet WCAG 2.2 AA targets in `UI_SPEC.md`.

For booking, visit completion/prescription entry, and leave confirmation, verify complete keyboard operation with visible focus; semantic names, headings, errors, status text, and dialog focus restoration; 44 × 44 CSS px mobile touch targets; no color-only meaning; and no clipped controls or page-level horizontal scrolling at 320 CSS px and 200% zoom. With reduced motion enabled, decorative motion stops and all content and actions remain available.

Required evidence: automated accessibility results supplemented by keyboard walkthrough notes, viewport/zoom captures, touch-target checks, and reduced-motion assertions.

### `AT-UI-004` — The visual reference is adapted, not copied

UI intent: the application uses the visual grammar in `UI_SPEC.md` while retaining its own healthcare identity.

Given the public/auth surface and one representative screen for each role, then the views consistently use the documented tokens, typography, restrained lime emphasis, dark primary controls, calendar/grid motif, radii, and role-based density. No Assemble/Onsemble brand, copy, layout reproduction, logo, screenshot, illustration, font file, or other third-party asset is present.

Required evidence: visual review across responsive breakpoints, token usage inspection, and repository asset/provenance review.

## Phase 0 exit gate

Phase 0 acceptance is complete when each scenario is traceable to a frozen domain or UI intent and future implementation ownership is clear. The scenarios are not claimed as passing until feature code, isolated test infrastructure, and synthetic fixtures exist in later phases.
