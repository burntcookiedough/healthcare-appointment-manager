# Environment reference

This repository uses one root `.env` for local API/web values and an explicit
`HEALTHCARE_WORKER_` prefix for worker settings. [`.env.example`](../.env.example)
is the copyable placeholder file; it intentionally contains no usable credentials.
In hosted environments, inject values through Vercel/Render/Railway/Supabase/Upstash
secret stores instead of committing an environment file.

## Configuration matrix

| Variable | Consumer | Required in the current snapshot | Safe local value/default | Hosted/degraded behavior |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Web browser | Yes for API-backed screens | `http://localhost:8000/api/v1` | Set to the API HTTPS origin plus `/api/v1`; it is public and must not contain a secret. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web (future auth lane) | No; mocked auth is usable | `https://YOUR_PROJECT_REF.supabase.co` | Public project URL only. Leave unset while the Supabase lane is incomplete. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web (future auth lane) | No; mocked auth is usable | `replace-with-supabase-anon-key` | Browser-safe anon key only; never put a service-role key here. |
| `APP_ENV` | API | No | `development` | Use `production` only after hosted secrets, CORS, and auth are configured. |
| `API_HOST` / `API_PORT` | API | No | `0.0.0.0` / `8000` | Render/Railway supplies `PORT`; the runbook passes it to Uvicorn. |
| `API_PREFIX` | API | No | `/api/v1` | Keep stable; changing it requires a contract/client decision. |
| `DATABASE_URL` | API and future durable dispatcher | Yes for readiness/migrations | `postgresql+asyncpg://healthcare:healthcare@localhost:5432/healthcare` | The API uses asyncpg; convert a provider's `postgresql://` URL to `postgresql+asyncpg://` while preserving TLS/query options. Do not expose it to the browser. |
| `HOLD_TTL_SECONDS` | API | No | `600` (10 minutes) | Keep one documented value across web/API; the server clock and database state are authoritative. |
| `READINESS_TIMEOUT_SECONDS` | API | No | `2` | Bound readiness probes; a failed database check returns `503 DEPENDENCY_UNAVAILABLE`. |
| `LOG_LEVEL` | API | No | `INFO` | Use structured, PHI-safe logs; never increase detail by logging request bodies. |
| `SUPABASE_URL` | API (future JWT lane) | No in Phase 1 | Same project placeholder as above | Required before accepting Supabase JWTs; keep server-side. |
| `SUPABASE_JWT_SECRET` | API (future JWT lane) | No in Phase 1 | `replace-with-supabase-jwt-verification-secret` | Inject through a secret store. The current Phase 1 actor lookup does not validate this value. |
| `REDIS_URL` | Compatibility/future dispatcher | No in current API | `redis://localhost:6379/0` | Use a TLS URL from Upstash/managed Redis when a dispatcher is integrated. |
| `CELERY_BROKER_URL` | Compatibility/future dispatcher | No in current API | `redis://localhost:6379/0` | Not read by the current worker; retain only until the API dispatcher contract is frozen. |
| `CELERY_RESULT_BACKEND` | Compatibility/future dispatcher | No | `redis://localhost:6379/1` | Worker results are optional; PostgreSQL outbox state remains durable authority. |
| `HEALTHCARE_WORKER_BROKER_URL` | Worker | Yes to process a real Celery worker | `redis://localhost:6379/0` | Inject as a secret/private URL; the worker reconnects on startup. `--smoke` does not need Redis. |
| `HEALTHCARE_WORKER_RESULT_BACKEND_URL` | Worker | No | `redis://localhost:6379/1` | Optional; do not treat broker results as business state. |
| `HEALTHCARE_WORKER_SERVICE_NAME` | Worker | No | `healthcare-worker` | Use a stable service name for logs/metrics. |
| `HEALTHCARE_WORKER_ENVIRONMENT` | Worker | No | `development` | Allowed values are `development`, `test`, `staging`, and `production`. |
| `HEALTHCARE_WORKER_EVENT_VERSION` | Worker | No | `1` | Reject unsupported event versions terminally; coordinate changes with the outbox producer. |
| `HEALTHCARE_WORKER_MAX_RETRIES` | Worker | No | `5` | Bounded redelivery; tune only with an operational decision. |
| `HEALTHCARE_WORKER_RETRY_BASE_DELAY_SECONDS` | Worker | No | `5` | Exponential backoff base. |
| `HEALTHCARE_WORKER_RETRY_MAX_DELAY_SECONDS` | Worker | No | `900` | Hard delay cap. |
| `HEALTHCARE_WORKER_RETRY_JITTER_SECONDS` | Worker | No | `3` | Jitter reduces synchronized provider retries. |
| `HEALTHCARE_WORKER_TASK_QUEUE` | Worker | No | `healthcare-worker` | Keep API dispatcher routing aligned if the queue name changes. |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | Future LLM adapter | No; fake adapter is default | `none`, blank, blank | Blank/disabled means generated artifacts are `unavailable` or `pending`; booking, original notes, and visit completion continue. |
| `LLM_TIMEOUT_SECONDS` | Future LLM adapter | No | `15` | Enforce a bounded provider timeout and record a normalized retryable failure. |
| `LLM_PROMPT_VERSION` / `LLM_SCHEMA_VERSION` | Future LLM adapter | No | `pre_visit_summary.v1` / `clinical_summary.v1` | Persist versions with each generated artifact; do not silently change prompts. |
| `SENDGRID_API_KEY` | Future email adapter | No; fake adapter is default | blank | Blank means notification status remains pending/failed and the appointment is still valid. |
| `SENDGRID_FROM_EMAIL` | Future email adapter | No | `notifications@example.invalid` | Must be a verified sender in the provider account before production use. |
| `SENDGRID_TEMPLATE_PREFIX` | Future email adapter | No | `healthcare` | Keep template identifiers out of PHI-bearing queue payloads. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Future Calendar OAuth | No; fake adapter is default | blank | Missing values disable Calendar projection without changing appointments. Secret stays server-side. |
| `GOOGLE_REDIRECT_URI` | Future Calendar OAuth | No | `http://localhost:8000/api/v1/integrations/google/callback` | Must exactly match the OAuth client allowlist and hosted HTTPS callback. |
| `GOOGLE_REFRESH_TOKEN` | Future Calendar worker | No | blank | Store encrypted in a managed secret store; never put it in queue payloads or browser config. |
| `GOOGLE_CALENDAR_ID` / `GOOGLE_OAUTH_SCOPES` | Future Calendar worker | No | `primary` / `...calendar.events` | Use least-privilege scopes and minimum event data; see [INTEGRATIONS.md](INTEGRATIONS.md). |
| `SEED_DEMO_DATA` | Human/operator metadata | No | `false` | Documentation-only switch today; load [`infra/seed-demo.sql`](../infra/seed-demo.sql) explicitly. |

## Required combinations

- API startup/readiness: `DATABASE_URL`; PostgreSQL must have migration
  `0001_booking_foundation`.
- Web: `NEXT_PUBLIC_API_URL`; Supabase values remain optional while the frontend uses
  the mock/session lane.
- Worker process: `HEALTHCARE_WORKER_BROKER_URL`; a result backend is optional.
- External integrations: all provider variables are optional for core booking. A
  missing/failed provider must create an explicit integration/derived-output status,
  never roll back a committed appointment or overwrite original clinical text.

## Local loading rules

1. Copy `.env.example` to `.env` at the repository root.
2. The API's Pydantic settings reads `.env` and `../../.env` when run from
   `apps/api`.
3. The worker settings intentionally do not read arbitrary dotenv files. Export the
   `HEALTHCARE_WORKER_*` values in the shell or configure the process manager to load
   the same secret file. Do not assume that starting from the repository root makes
   worker values visible.
4. Never use `NEXT_PUBLIC_*` for database, Redis, OAuth, SendGrid, or LLM secrets.

## Secret and PHI rules

- Keep `.env` ignored; only `.env.example` is tracked.
- Rotate a credential if it appears in a log, task name, URL, commit, screenshot, or
  test fixture.
- Use synthetic actors/text for demos and tests.
- Do not place symptoms, notes, prescriptions, generated content, refresh tokens, or
  access tokens in `DATABASE_URL` query strings, queue payloads, request IDs, or logs.
- Hosted deployments should use separate credentials for API, worker, migrations, and
  provider integrations where the platform supports it.
