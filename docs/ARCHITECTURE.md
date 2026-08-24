# Architecture

Status: Phase 0 architecture contract. This document freezes system boundaries and reliability rules for implementation. Detailed domain rules, schemas, endpoints, and UI behavior belong to their dedicated contracts.

## System context

The product has separate patient, doctor, and administrator experiences in one web application. The browser never talks directly to PostgreSQL, Redis, Celery, SendGrid, Google Calendar, or an LLM provider for application workflows. All authorization and domain decisions are enforced by the API.

```text
Browser
  | HTTPS + Supabase access token
  v
Next.js web application ---- generated TypeScript client ----> FastAPI API
                                                                   |
                                                                   v
                                                              PostgreSQL
                                                            (system of record)
                                                                   |
                                                     committed outbox rows
                                                                   v
                                                         outbox dispatcher
                                                                   |
                                                                   v
Redis broker ------------------------------------------------> Celery worker
                                                                   |
                                                                   +--> SendGrid
                                                                   +--> Google Calendar OAuth
                                                                   +--> provider-neutral LLM adapter

Supabase Auth issues identities and tokens; the API verifies identity and applies RBAC.
```

## Runtime and ownership boundaries

| Boundary | Responsibilities | Must not own |
|---|---|---|
| `apps/web` | Render patient, doctor, and admin experiences; establish the Supabase user session; call the API through the generated client; present pending and failed integration states | Authorization decisions, booking conflict resolution, provider secrets, or hand-written copies of API types |
| `apps/api` | Verify authentication; enforce server-side RBAC and resource ownership; validate commands; execute booking and clinical transactions; expose OpenAPI; create outbox work atomically | Long-running provider calls or treating Redis as durable business state |
| `apps/worker` | Dispatch and process committed outbox work; run reminders; call email, calendar, and LLM adapters; retry safely; record outcomes | Creating or invalidating authoritative appointments through provider success or failure |
| `packages/api-client` | Orval-generated TypeScript bindings from the accepted FastAPI OpenAPI document | Hand-edited generated contracts or independent domain behavior |
| PostgreSQL | Authoritative users/profile links, schedules, leave, appointments, clinical records, prescriptions, reminder definitions, outbox records, and integration status | Provider credentials in plaintext or transient broker state |
| Redis/Celery | Task delivery, scheduling support, and short-lived coordination | Slot ownership, booking correctness, or the only copy of required work |
| Integration adapters | Translate internal commands to provider APIs and normalize provider responses/errors | Domain authorization or mutation of committed clinical/booking truth outside API/worker rules |

FastAPI OpenAPI is the wire-contract source. The generated client is refreshed only from a reviewed OpenAPI artifact; frontend mocks may implement that contract but do not redefine it.

## Trust, identity, and authorization

1. A user authenticates with Supabase Auth. The browser receives a user-scoped session; privileged Supabase credentials and integration secrets remain server-side.
2. The web application sends the access token over HTTPS to FastAPI. Browser-supplied roles, user IDs, doctor IDs, and ownership claims are untrusted input.
3. FastAPI verifies token signature and required claims using the configured Supabase project metadata, then maps the immutable external subject to an internal actor record.
4. FastAPI applies server-side role and resource checks for every protected operation. Patient, doctor, and administrator capabilities are deny-by-default and are specified in the API/domain contracts.
5. Workers receive internal identifiers and the minimum payload needed for a task. They do not accept end-user authorization claims and do not become an alternate public API.

Authentication establishes identity; it does not by itself grant access to a record. In particular, a valid patient cannot select another patient's data, and a valid doctor cannot access an unrelated appointment merely by guessing its identifier. Administrator access remains explicit and auditable rather than implied by frontend routing.

## Booking consistency contract

PostgreSQL is the sole authority for whether a doctor/time interval can be booked. Availability shown by the web application is advisory until the booking transaction commits. Redis locks, cached availability, client-side disabling, worker serialization, and calendar-provider availability may improve experience but can never prove ownership of a slot.

The API must perform a booking command in one PostgreSQL transaction:

1. Authenticate and authorize the actor, normalize the requested interval, and validate the referenced patient and doctor.
2. Within the transaction, validate schedule, leave, hold (if the accepted domain contract includes holds), and conflict rules using database concurrency control.
3. Insert the appointment and every required outbox record in that same transaction.
4. Commit once. A conflict produces a stable domain error and no appointment or outbox residue.
5. Return success only for the committed appointment. Notification or calendar state may still be pending.

The implementation must use a PostgreSQL-enforced strategy that remains correct under concurrent requests and retries. The exact combination of constraints, exclusion ranges, locks, isolation level, and idempotency keys is deferred to the booking/schema design, but an application-only read-then-insert check is not acceptable. Cancellation, rescheduling, and expiring holds must preserve the same database-authority rule and must not briefly expose two committed owners for the same protected interval.

## Transactional outbox contract

Any asynchronous action required because a domain transaction committed is represented by an outbox row created in that transaction. This includes email, calendar synchronization, LLM work, and reminders where applicable. API code does not call those providers inside the booking or clinical transaction.

The outbox lifecycle is:

```text
domain transaction
  -> pending outbox row
  -> safely claimed by a dispatcher/worker
  -> provider attempt
       -> succeeded (provider reference and completion recorded)
       -> retryable failure (attempt metadata + delayed retry)
       -> terminal failure (retained for diagnosis/manual recovery)
```

Processing is at-least-once: a worker can stop after a provider accepted a request but before local success was recorded. Therefore, handlers must be idempotent or use a stable idempotency/deduplication key derived from the outbox event. Claiming must prevent concurrent successful processing while allowing abandoned claims to be recovered. Attempt count, next-attempt time, last normalized error, and terminal/success state are durable in PostgreSQL. Redis loss may delay work but cannot erase it; a reconciliation path must rediscover eligible outbox rows.

Retry policy is bounded, uses backoff and jitter, and distinguishes retryable provider/network errors from permanent validation or authorization failures. Terminal rows are not deleted automatically as if successful. Payloads must be versioned enough for workers to reject incompatible work safely. Retention duration, replay tooling, and exact claim mechanism are deferred, but replay must not create duplicate user-visible effects.

## External failure isolation

- A committed appointment remains valid when SendGrid, Google Calendar, Redis, Celery, or an LLM is unavailable. The integration status becomes pending, retrying, or failed; it does not roll back or silently delete the appointment.
- Email is a notification channel, not proof that a booking exists.
- Google Calendar is a projection of the PostgreSQL appointment. Calendar event IDs and sync status are stored for reconciliation. Provider edits or failures cannot silently replace authoritative appointment state.
- LLM output is optional, untrusted derived content. It must be schema-validated and visibly distinguishable from clinician-authored or patient-authored source material. Original symptoms and doctor notes are immutable with respect to LLM processing: generation, regeneration, or failure never overwrites them.
- Medication reminder timing is computed only from reviewed structured prescription fields. Generated prose is never parsed as the authoritative schedule.
- Provider-specific clients stay behind adapters so business code consumes internal commands/results and can use deterministic fakes in focused tests.

Clinical safety decisions and diagnosis remain outside the LLM boundary. The UI and API must support an explicit unavailable/failed derived-output state rather than fabricating successful content.

## Topology

### Local development

- The developer runs the Next.js web process, FastAPI process, and Celery worker as separate runtimes.
- The root `compose.yaml` provides local PostgreSQL and Redis.
- External providers use explicit development credentials or fakes selected through configuration. No real secret is committed, and a local environment must be able to exercise core booking correctness without provider availability.
- API and worker use the same PostgreSQL schema and compatible application version. Database migrations are applied deliberately, not implicitly by each process at startup.

### Hosted target

| Runtime | Target | Network/secret expectations |
|---|---|---|
| Next.js web | Vercel | Public HTTPS edge; only browser-safe configuration is exposed to client bundles |
| FastAPI API | Railway | Public HTTPS API; private database, broker, auth-verification, and provider configuration |
| Celery worker | Railway | No public application surface; private database/broker access and only required provider credentials |
| PostgreSQL and Auth | Supabase | PostgreSQL is reached only by server runtimes; Auth public configuration is distinct from privileged server credentials |
| Redis | Upstash | Transport authentication/encryption; broker data is non-authoritative and recoverable from PostgreSQL outbox state |

Production CORS, callback URLs, OAuth redirects, and service-to-service network policy use explicit allowlists. Hosted services must not share a single all-powerful credential when a narrower credential is available. Deployment and provisioning remain outside Phase 0.

## Observability and operations

Every inbound request receives a correlation ID. Domain transactions, outbox rows, Celery tasks, and provider attempts carry that correlation plus stable internal appointment/event identifiers so one workflow can be traced without logging sensitive content. Logs are structured and include service, environment, operation, outcome, duration, retry classification, and safe error codes.

Minimum operational signals are API request/error latency, database transaction/conflict rates, booking conflict outcomes, pending outbox age and depth, claim age, retry/terminal counts by integration, worker liveness, reminder lateness, and calendar reconciliation drift. Alerts prioritize stuck or aging durable work and sustained failures over individual expected booking conflicts.

Health endpoints distinguish process liveness from dependency readiness. A provider outage must not make the API incapable of serving committed appointment state. Audit events are required for security-sensitive access and material appointment/clinical mutations; audit records identify actor, action, target, time, and outcome without copying full clinical content.

## Data sensitivity and handling

Identity, appointments, symptoms, visit notes, prescriptions, reminders, and derived LLM content are sensitive health-related data. Apply least privilege in API queries, worker payloads, provider requests, database roles, and operational access.

- Encrypt traffic in transit and use managed encryption at rest in hosted services.
- Keep secrets in environment/managed secret stores; never in source, generated clients, logs, task names, URLs, or browser bundles.
- Do not log access tokens, OAuth refresh tokens, email bodies, symptom text, notes, prescriptions, prompts, or model responses. Redact provider errors before persistence or logging.
- Send each external provider only the minimum data required for the accepted feature. LLM prompts must exclude direct identifiers unless a later reviewed requirement and provider agreement explicitly permits them.
- Keep OAuth tokens server-side and encrypted using a documented key-management approach; workers receive references rather than exposing credentials in queue payloads.
- Define retention, deletion, export, consent, audit access, backup, and restore policy before production data is accepted. Development and test fixtures use synthetic data.

This contract is an engineering boundary, not a claim of regulatory compliance. Applicable legal jurisdiction, provider agreements, and formal security/compliance review must be established before production use.

## Deferred decisions

The following are intentionally not frozen by this document and require dedicated review before their implementation boundary begins:

- Detailed entity schema, identifiers, appointment interval semantics, time-zone/DST policy, hold model and TTL, cancellation/reschedule policy, and PostgreSQL conflict-control mechanism.
- Endpoint shapes, error catalog, pagination, idempotency header contract, OpenAPI publication workflow, and client-generation versioning.
- Exact Supabase JWT validation mode, role/claim storage, session refresh behavior, administrator provisioning, and authorization matrix.
- Celery broker/result configuration, outbox claim algorithm, retry ceilings, terminal-work operator flow, event schema/version policy, and retention periods.
- Email templates and consent rules; Google Calendar scopes, conflict direction, webhook/reconciliation design, and token-encryption/key-rotation mechanism.
- LLM provider/model, data-processing terms, prompt/version registry, validation schema, human-review UX, evaluation thresholds, and derived-content retention.
- Production regions, network controls, secrets platform, backup/restore objectives, disaster recovery targets, log/metric vendor, alert thresholds, and cost controls.
- Regulatory classification, data residency, consent, record retention/deletion, incident response, accessibility evidence, and formal threat model.

No deferred choice may weaken the non-negotiable rules above: PostgreSQL remains booking authority; the appointment and required outbox work commit atomically; external/LLM failure cannot invalidate committed appointments; originals remain preserved; and reminder schedules come from structured prescription data.
