# External integration setup

This repository contains provider ports, retry/idempotency handling, and a durable
PostgreSQL outbox poller. It does not contain a provider account, secret, hosted URL, or
claim of production delivery. Provider calls are optional projections: an appointment,
visit, prescription, or reminder remains valid when a provider is absent or fails.

The worker reads the exact `HEALTHCARE_WORKER_*` settings listed in
[`ENVIRONMENT.md`](ENVIRONMENT.md). Do not reintroduce unprefixed `SENDGRID_*`,
`GOOGLE_*`, or `LLM_*` names for worker configuration.

## Durable delivery boundary

The API writes `outbox_events` and `integration_operations` in the same PostgreSQL
transaction as the domain mutation. Render/native deployments assume the worker lane
provides `uv run python -m healthcare_worker --poller` from `apps/worker`. The package
entrypoint calls `build_outbox_poller`, claims rows with `FOR UPDATE SKIP LOCKED`, applies
leases, and persists retry/terminal state. Redis/Celery can transport task notifications
but is not the only drain and is never the source of booking truth.

The production runtime factory defaults to `PostgresTrustedDataResolver`, bound to the
outbox store's PostgreSQL pool. Network adapters therefore fail closed only when required
provider credentials are missing or trusted-reference resolution fails, returning
`PROVIDER_NOT_CONFIGURED` or a normalized resolver error as appropriate. This is honest
degraded behavior: the durable row remains observable and the committed domain record is
not rolled back.

## Google Calendar OAuth 2.0

The Calendar adapter is server-side. The browser never receives a client secret, OAuth
refresh token, or provider access token. Configure only these worker settings in a
managed secret store:

- `HEALTHCARE_WORKER_GOOGLE_CLIENT_ID`
- `HEALTHCARE_WORKER_GOOGLE_CLIENT_SECRET`
- `HEALTHCARE_WORKER_GOOGLE_TOKEN_ENDPOINT`
- `HEALTHCARE_WORKER_GOOGLE_CALENDAR_ENDPOINT`

The worker's trusted resolver supplies the short-lived access token and calendar
reference for an opaque appointment operation. A refresh token belongs in the API's
reviewed OAuth/token store, not in an outbox payload or browser variable; this snapshot
does not expose a Google OAuth callback route. If a future API OAuth lane is enabled, use
exact HTTPS redirect allowlists, validate state/CSRF, encrypt and rotate refresh tokens,
and record revocation/reconciliation behavior before production.

Use the least-privilege Calendar events scope, minimum scheduling data, and a stable
operation idempotency key. Calendar titles/descriptions must not contain symptoms,
notes, prescriptions, diagnoses, generated summaries, or access tokens. A duplicate
delivery must converge on one logical provider event, and a Calendar outage must leave
the PostgreSQL appointment confirmed.

## SendGrid

Configure these worker settings only after sender/domain and consent review:

- `HEALTHCARE_WORKER_SENDGRID_API_KEY`
- `HEALTHCARE_WORKER_SENDGRID_FROM_EMAIL`
- `HEALTHCARE_WORKER_SENDGRID_ENDPOINT`
- `HEALTHCARE_WORKER_PROVIDER_TIMEOUT_SECONDS`

Use a restricted Mail Send key and a verified sender. The trusted resolver obtains the
recipient and approved template data from the database; queue payloads carry opaque
references rather than email addresses, message bodies, symptoms, or notes. Keep SPF,
DKIM, suppression, bounce, unsubscribe, rate-limit, and alert policies outside source.

Exercise transient failure, permanent rejection, and redelivery with deterministic fake
adapters. A transient error records attempt/next-attempt state, and a terminal error
remains visible for an authorized retry. Neither outcome changes appointment validity.

## LLM summaries

Configure only after privacy, data-processing, retention, residency, safety, and model
review:

- `HEALTHCARE_WORKER_LLM_ENDPOINT`
- `HEALTHCARE_WORKER_LLM_API_KEY`
- `HEALTHCARE_WORKER_LLM_PROVIDER` (`none`, `disabled`, `openai`, `gemini`, or `generic`)
- `HEALTHCARE_WORKER_LLM_MODEL`
- `HEALTHCARE_WORKER_LLM_PROMPT_VERSION`
- `HEALTHCARE_WORKER_LLM_SCHEMA_VERSION`
- `HEALTHCARE_WORKER_LLM_VALIDATION_RETRIES`
- `HEALTHCARE_WORKER_PROVIDER_TIMEOUT_SECONDS`

The adapter receives an opaque source reference, resolves the minimum necessary source
text server-side, strips direct identifiers, requests structured output, validates it
again, and records provenance. A blank endpoint/key or a trusted-reference resolution
failure produces an explicit unavailable/failed derived-output state; it does not block
booking, saving original notes, completing a visit, or scheduling from structured
prescription fields.
Generated output is advisory and labeled; it cannot diagnose, prescribe, overwrite
source text, or create reminders. See [`LLM_PROMPTS.md`](LLM_PROMPTS.md) for prompt and
schema version records.

Set `HEALTHCARE_WORKER_LLM_PROVIDER=none` or `disabled` to explicitly disable LLM work;
the other provider values require their reviewed endpoint, model, and credentials.

## Operational checklist

- Keep database, Redis, OAuth, SendGrid, and LLM credentials server-side and separate by
  environment/service.
- Keep TLS/private URLs for hosted dependencies and never place credentials in queue
  payloads, logs, URLs, or frontend bundles.
- Monitor pending outbox age, claim/lease recovery, retry/terminal counts, integration
  state, and provider reference reconciliation.
- Redact provider exception text and all clinical/identity fields from logs.
- Revoke and rotate a credential immediately if it appears in a commit, log, screenshot,
  queue payload, or browser bundle.
