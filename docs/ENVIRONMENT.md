# Environment reference

The checked-in [`.env.example`](../.env.example) is a placeholder matrix for the
current executable API, web adapter, and durable worker. Hosted values belong in
Vercel/Render/Railway/Supabase/Redis secret stores; no credential or hosted URL is
committed. The API reads the root `.env`. The worker uses only the explicit
`HEALTHCARE_WORKER_*` names and does not implicitly load dotenv files.

Render's native Python services pin the platform runtime in [`render.yaml`](../render.yaml)
with the supported `PYTHON_VERSION=3.13.7` and `UV_VERSION=0.11.13` environment controls.
These two variables select the hosted toolchain; they are not read by the API or worker
settings and are intentionally not part of the local `.env.example` application matrix.

## Web variables

| Variable | Consumer | Local value | Hosted/degraded behavior |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Next.js browser client | `http://localhost:8000/api/v1` | Public API base including `/api/v1`; never include a secret. |
| `NEXT_PUBLIC_API_BASE_URL` | Next.js browser client | blank (optional alias) | Use the API origin when this alias is preferred; the client appends `/api/v1`. Configure only one URL form. |
| `NEXT_PUBLIC_DEMO_MODE` | Next.js browser client | `false` | Set `true` only for deterministic in-memory demo fixtures. Production role switching and fixture fallbacks are disabled. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase browser auth | project placeholder | Public project URL only; no service-role credential. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser auth | placeholder | Browser-safe anon key only; leave unset while auth is not provisioned. |

`apps/web/src/lib/api/client.ts` selects HTTP mode when a URL is configured and
`NEXT_PUBLIC_DEMO_MODE` is not `true`. It sends the Supabase bearer token, generates
opaque idempotency keys for mutation calls, and performs one deduplicated session
refresh after a `401`. Demo mode is intentionally separate from the API/database.

## API variables

| Variable | Consumer | Local value/default | Hosted/degraded behavior |
| --- | --- | --- | --- |
| `APP_ENV` | FastAPI | `development` | Use `production` only with JWT, CORS, database, and secret review. |
| `API_HOST` / `API_PORT` | FastAPI | `0.0.0.0` / `8000` | Render supplies `PORT`; the manifest passes it to Uvicorn. |
| `API_PREFIX` | FastAPI | `/api/v1` | Keep stable with the web client and health probe. |
| `DATABASE_URL` | FastAPI/Alembic | `postgresql+asyncpg://healthcare:healthcare@localhost:5432/healthcare` | Required for readiness and migrations; server-only. |
| `HOLD_TTL_SECONDS` | Booking service | `600` | Server/database time owns expiry; clients cannot extend a hold. |
| `READINESS_TIMEOUT_SECONDS` | Readiness probe | `2` | Bounds the PostgreSQL check; failure returns `503 DEPENDENCY_UNAVAILABLE`. |
| `LOG_LEVEL` | API logging | `INFO` | Keep logs structured and PHI-safe. |
| `SUPABASE_URL` | API operator metadata | project placeholder | Keep server-side; it does not replace token verification settings. |
| `SUPABASE_JWT_PUBLIC_KEY` | API JWT verifier | blank PEM placeholder | Preferred hosted verification key for RS256/ES256; inject through a secret store. |
| `SUPABASE_JWT_ISSUER` | API JWT verifier | `https://YOUR_PROJECT_REF.supabase.co/auth/v1` | Must exactly match the token `iss` claim. |
| `SUPABASE_JWT_AUDIENCE` | API JWT verifier | `authenticated` | Must match the configured Supabase audience. |
| `SUPABASE_JWT_SECRET` | API JWT verifier | blank | Optional legacy HS256 path only; never commit a real secret when using it. |
| `AUTH_ALLOW_LOCAL_TEST_TOKENS` | API auth | `true` for local seeded tests | Must be `false` in hosted production. `test:<subject>` is accepted only in local/development/test environments. |

The API fails closed when a real JWT cannot be verified. It maps the verified subject
to an active application actor before applying patient/doctor/admin ownership rules.

## Worker and durable outbox variables

All names below map directly to `healthcare_worker.config.WorkerSettings` and must retain
the prefix. `HEALTHCARE_WORKER_DATABASE_URL` is the PostgreSQL URL used by the durable
poller; it is separate from the API's `DATABASE_URL` key even when both point to the
same database.

| Variable | Local default | Hosted/degraded behavior |
| --- | --- | --- |
| `HEALTHCARE_WORKER_SERVICE_NAME` | `healthcare-worker` | Stable service/metric label. |
| `HEALTHCARE_WORKER_ENVIRONMENT` | `development` | `production` on Render/Railway. |
| `HEALTHCARE_WORKER_DATABASE_URL` | `postgresql://healthcare:healthcare@localhost:5432/healthcare` | Required by the worker-package `--poller` entrypoint; private server-only URL. |
| `HEALTHCARE_WORKER_BROKER_URL` | `redis://localhost:6379/0` | Celery transport only; Redis is never business-state authority. |
| `HEALTHCARE_WORKER_RESULT_BACKEND_URL` | `redis://localhost:6379/1` | Optional result transport; durable outcome remains PostgreSQL. |
| `HEALTHCARE_WORKER_EVENT_VERSION` | `1` | Reject unsupported event envelopes terminally. |
| `HEALTHCARE_WORKER_MAX_RETRIES` | `5` | Bounded redelivery ceiling. |
| `HEALTHCARE_WORKER_RETRY_BASE_DELAY_SECONDS` | `5` | Exponential backoff base. |
| `HEALTHCARE_WORKER_RETRY_MAX_DELAY_SECONDS` | `900` | Hard retry delay cap. |
| `HEALTHCARE_WORKER_RETRY_JITTER_SECONDS` | `3` | De-synchronizes provider retries. |
| `HEALTHCARE_WORKER_TASK_QUEUE` | `healthcare-worker` | Celery queue/routing name; not an outbox store. |
| `HEALTHCARE_WORKER_OUTBOX_POLL_INTERVAL_SECONDS` | `2` | Poll wake interval for pending/retryable rows. |
| `HEALTHCARE_WORKER_OUTBOX_BATCH_SIZE` | `50` | Maximum rows claimed per poll; bounded by concurrency. |
| `HEALTHCARE_WORKER_OUTBOX_LEASE_SECONDS` | `120` | Claim lease/fencing window; expired processing rows are recoverable. |
| `HEALTHCARE_WORKER_MAX_CONCURRENCY` | `10` | Bounded in-process provider attempt concurrency. |
| `HEALTHCARE_WORKER_PROVIDER_TIMEOUT_SECONDS` | `10` | Timeout for external adapter calls. |
| `HEALTHCARE_WORKER_SENDGRID_API_KEY` | blank | Blank or missing provider credentials yield `PROVIDER_NOT_CONFIGURED`; appointments remain valid. |
| `HEALTHCARE_WORKER_SENDGRID_FROM_EMAIL` | `notifications@example.invalid` | Must be a verified sender before sending. |
| `HEALTHCARE_WORKER_SENDGRID_ENDPOINT` | SendGrid HTTPS endpoint | Keep HTTPS and use the reviewed provider endpoint. |
| `HEALTHCARE_WORKER_GOOGLE_CLIENT_ID` | blank | OAuth client ID for the server-side Calendar adapter. |
| `HEALTHCARE_WORKER_GOOGLE_CLIENT_SECRET` | blank | Server-only OAuth secret; store in a managed secret store. |
| `HEALTHCARE_WORKER_GOOGLE_TOKEN_ENDPOINT` | Google token endpoint | Reserved for the reviewed OAuth flow; no browser exposure. |
| `HEALTHCARE_WORKER_GOOGLE_CALENDAR_ENDPOINT` | Google Calendar API endpoint | Keep HTTPS; Calendar is only a projection. |
| `HEALTHCARE_WORKER_LLM_ENDPOINT` | blank | Blank disables network generation and leaves derived artifacts pending/failed. |
| `HEALTHCARE_WORKER_LLM_API_KEY` | blank | Server-only provider key. |
| `HEALTHCARE_WORKER_LLM_PROVIDER` | `generic` | Allowed values are `none`, `disabled`, `openai`, `gemini`, or `generic`; `none`/`disabled` explicitly turn off LLM work. |
| `HEALTHCARE_WORKER_LLM_MODEL` | blank | Configure only after privacy/model review. |
| `HEALTHCARE_WORKER_LLM_PROMPT_VERSION` | `clinical.v1` | Persist/version any generated artifact provenance. |
| `HEALTHCARE_WORKER_LLM_SCHEMA_VERSION` | `clinical.v1` | Validate structured output against the reviewed schema. |
| `HEALTHCARE_WORKER_LLM_VALIDATION_RETRIES` | `2` | Bounded schema-validation retries. |

The Render worker command is
`uv run python -m healthcare_worker --poller` from the `apps/worker` root. That package
entrypoint calls the existing `build_outbox_poller` factory and claims PostgreSQL
`outbox_events` directly. The production factory defaults to
`PostgresTrustedDataResolver`, bound to the outbox store's PostgreSQL pool. Provider
calls therefore degrade only when required provider credentials are missing or trusted-reference
resolution fails; those failures do not roll back committed domain records or prove that
Celery drained the outbox.

## Required combinations and local loading

1. Copy `.env.example` to `.env`, start `docker compose up -d postgres redis`, and run
   `cd apps/api; uv run alembic upgrade head`.
2. API readiness requires a reachable database migrated through `0002_application_domain`.
3. Worker polling requires `HEALTHCARE_WORKER_DATABASE_URL`; Celery smoke checks do not
   prove durable polling.
4. Never use `NEXT_PUBLIC_*` for database, Redis, OAuth, SendGrid, or LLM secrets.
5. Blank/missing providers must surface a separate pending/retryable/failed integration
   state and must never undo a committed appointment or overwrite original clinical text.

## Secret and PHI rules

- Keep `.env` ignored; only `.env.example` is tracked.
- Rotate credentials if they appear in logs, URLs, commits, screenshots, queue payloads,
  or task names.
- Use synthetic actors/text for demos and tests.
- Do not place symptoms, notes, prescriptions, refresh tokens, access tokens, or provider
  payloads in URLs, idempotency keys, queue names, or general logs.
- Use separate least-privilege credentials for API, migrations, worker, and providers.
