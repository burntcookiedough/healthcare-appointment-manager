# Healthcare Appointment & Follow-up Manager

Contract-first monorepo for a healthcare scheduling and follow-up system serving
patients, doctors, and administrators. The current source snapshot contains an
executable FastAPI domain API, PostgreSQL `0001`/`0002` schema, durable outbox worker
poller, and a Next.js frontend with explicit HTTP and demo adapters. It is not a hosted
service and it must be exercised with synthetic data only.

## What is shipped in this snapshot

| Area | Current state |
| --- | --- |
| Web | Patient, doctor, and admin Next.js experiences call a typed HTTP adapter when configured and switch to deterministic fixtures only with explicit `NEXT_PUBLIC_DEMO_MODE=true`. |
| API | FastAPI process with health, auth/profile, doctor/schedule/leave, availability/holds/appointments, visits/symptoms/prescriptions, reminders, and integration-status routes under `/api/v1`. |
| Database | PostgreSQL 17 migrations `0001_booking_foundation` and `0002_application_domain` with booking, clinical source, generated-artifact, reminder, integration, history, leave-preview, outbox, and audit tables. |
| Worker | Durable PostgreSQL outbox claim/lease/retry poller plus Celery transport boundary, typed provider adapters, deterministic fakes, bounded concurrency, and PHI-minimizing logs. Provider delivery remains explicitly degraded until a trusted resolver is configured. |
| API client gate | Runtime OpenAPI is available, but a reviewed committed artifact and generated Orval client are still pending. See [docs/API_GUIDE.md](docs/API_GUIDE.md) before enabling hosted web HTTP mode. |

No hosted URL, production credential, provider account, or deployment is claimed by
this repository.

## Repository map

- `apps/web` — Next.js frontend owned by the Gemini Antigravity lane.
- `apps/api` — FastAPI API, SQLAlchemy models, Alembic migrations, and API tests.
- `apps/worker` — durable outbox poller, Celery transport, event envelope, adapters,
  retry, and worker tests.
- `packages/api-client` — placeholder for the reviewed Orval-generated client; it is
  not generated until the OpenAPI gate is complete.
- `infra` — local/demo seed and deployment notes; no production infrastructure is
  provisioned here.
- `docs` — architecture, domain/API contracts, environment and deployment guides,
  schema/LLM records, system-design submission, and checklists.

Start with [PLAN.md](PLAN.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
[docs/README.md](docs/README.md) before changing a subsystem.

## Prerequisites

Install these tools before following the setup below:

- Node.js 24 or newer (the root `package.json` declares `node >=24`).
- pnpm 11.23.0 (the `packageManager` field and `pnpm-lock.yaml` are authoritative).
- Python 3.13 or newer (both Python applications declare `requires-python >=3.13`).
- [uv](https://docs.astral.sh/uv/) for frozen Python environments.
- Docker Desktop with Compose v2, or a PostgreSQL 17 and Redis 8-compatible local
  installation.
- Git, plus `curl` (or PowerShell's `Invoke-WebRequest`) for API smoke checks.

Check versions before installing dependencies:

```text
node --version
pnpm --version
python --version
uv --version
docker compose version
```

## First-time setup

The root `.env.example` contains placeholders only. Never replace them with a real
token in a tracked file. The API reads a root `.env`; the worker receives its
`HEALTHCARE_WORKER_*` variables from the process environment (or from the secret store
used by the process manager). See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for the
complete matrix and degraded-mode behavior.

### Windows PowerShell

```powershell
Copy-Item .env.example .env
npm install --global pnpm@11.23.0
docker compose up -d postgres redis
pnpm install --frozen-lockfile
Push-Location apps/api
uv sync --locked --extra dev
uv run alembic upgrade head
Pop-Location
Push-Location apps/worker
uv sync --locked
Pop-Location
```

### macOS or Linux

```bash
cp .env.example .env
npm install --global pnpm@11.23.0
docker compose up -d postgres redis
pnpm install --frozen-lockfile
(cd apps/api && uv sync --locked --extra dev && uv run alembic upgrade head)
(cd apps/worker && uv sync --locked)
```

If pnpm is already managed by Corepack, `corepack enable` followed by
`corepack prepare pnpm@11.23.0 --activate` is equivalent to the global npm install.
The lockfile must stay frozen; do not run an unconstrained install for CI or a
submission build.

## Local services and demo data

The checked-in [compose.yaml](compose.yaml) starts only local PostgreSQL and Redis:

```text
docker compose up -d postgres redis
docker compose ps
```

PostgreSQL is exposed at `localhost:5432` with database/user/password `healthcare`.
Redis is exposed at `localhost:6379`. These credentials are for the disposable local
stack only.

The migration is deliberate and must run before the API or worker:

```text
cd apps/api
uv run alembic upgrade head
```

For a repeatable local smoke/demo database, load the synthetic actors, doctor, and
working hours from [infra/seed-demo.sql](infra/seed-demo.sql) after the migration.
On macOS/Linux:

```bash
docker compose exec -T postgres psql -U healthcare -d healthcare < infra/seed-demo.sql
```

On Windows PowerShell:

```powershell
Get-Content -Raw .\infra\seed-demo.sql | docker compose exec -T postgres psql -U healthcare -d healthcare
```

The seed is local-only and contains no Supabase users. For local smoke checks, set
`AUTH_ALLOW_LOCAL_TEST_TOKENS=true` (as in the example) and use the seeded subject values
as bearer tokens (`test:demo.patient`, `test:demo.doctor`, or `test:demo.admin`). The API
accepts this shortcut only in local/development/test environments; hosted production
must use verified Supabase JWTs and must set the flag to `false`.

## Run the applications

Run each process in a separate terminal from the repository root.

### Web (port 3000)

```text
pnpm --filter @healthcare-manager/web dev
```

The browser-safe `NEXT_PUBLIC_API_URL` defaults to
`http://localhost:8000/api/v1`. With `NEXT_PUBLIC_DEMO_MODE=false`, the web adapter sends
Supabase bearer-authenticated HTTP requests to the FastAPI routes. Set demo mode to
`true` only for the deterministic in-memory fixture experience; it is not a hosted data
source. The generated client remains pending the reviewed OpenAPI artifact.

### API (port 8000)

Windows PowerShell:

```powershell
Push-Location apps/api
uv run uvicorn healthcare_api.main:app --reload --host 0.0.0.0 --port 8000
Pop-Location
```

macOS/Linux:

```bash
(cd apps/api && uv run uvicorn healthcare_api.main:app --reload --host 0.0.0.0 --port 8000)
```

FastAPI publishes interactive docs for the executable routes at
`http://localhost:8000/api/v1/docs`, ReDoc at `/api/v1/redoc`, and the runtime
OpenAPI JSON at `/api/v1/openapi.json`. These are not yet a committed, reviewed
OpenAPI artifact; the gate is documented in [docs/API_GUIDE.md](docs/API_GUIDE.md).

### Worker

The broker-free import check is safe before Redis is available:

```text
cd apps/worker
uv run python -m healthcare_worker --smoke
```

To start the Celery process after exporting the worker variables from
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md):

```text
cd apps/worker
uv run celery -A healthcare_worker.celery_app:celery_app worker --loglevel=INFO
```

The durable poller is the process that drains committed PostgreSQL `outbox_events`.
Run the worker package's `--poller` entrypoint after exporting the variables in
[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md):

```text
cd apps/worker
uv run python -m healthcare_worker --poller
```

The `--poller-dry-run` option validates process wiring without opening PostgreSQL or
contacting a provider. The Celery process above is an optional transport/task boundary,
not the sole outbox drain. Provider adapters fail closed when credentials or the trusted
data resolver are absent; that degraded state never invalidates a committed appointment
or overwrites source text.

## Tests and checks

JavaScript workspace checks use the frozen pnpm lockfile:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The API quality checks also run Ruff format, mypy, and Python compilation. The full API
suite must run against an isolated PostgreSQL 17 database so integration tests are not
silently skipped:

```text
cd apps/api
uv sync --locked --extra dev
uv run alembic upgrade head
$env:HEALTHCARE_TEST_DATABASE_URL = "postgresql://healthcare:healthcare@localhost:5432/healthcare"
uv run pytest
```

The worker suite uses deterministic fakes and no provider network calls:

```text
cd apps/worker
uv run pytest
```

Run `uv run ruff check src tests`, `uv run ruff format --check src tests`,
`uv run mypy src`, and `uv run python -m compileall -q src tests` in each Python
application before submitting changes. Hosted CI provisions disposable PostgreSQL 17
services for the full API suite and worker environment but never sends provider traffic.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `connection refused` on port 5432/6379 | Run `docker compose ps`; inspect `docker compose logs postgres redis`; wait for the health checks before migrating. |
| Alembic cannot connect | Confirm the root `.env` `DATABASE_URL` uses `postgresql+asyncpg://` and run the command from `apps/api`. |
| `401 AUTHENTICATION_REQUIRED` locally | Load `infra/seed-demo.sql`, set `AUTH_ALLOW_LOCAL_TEST_TOKENS=true` in development, and use `test:demo.patient` (or the matching seeded subject). Hosted production requires a verified Supabase JWT. |
| Hold returns `SLOT_CONFLICT` | Availability is advisory. Check the doctor ID, UTC offset, configured duration, working hours, leave, and other active holds/appointments. Retry with a new idempotency key only for a new user intent. |
| Hold returns `HOLD_EXPIRED` | The server/database clock owns expiry. Create a new hold; do not extend a client countdown. |
| Worker starts but no provider call occurs | Verify the durable poller command, `HEALTHCARE_WORKER_DATABASE_URL`, migrated `outbox_events`, and safe provider/resolver configuration. Celery transport alone does not drain PostgreSQL outbox rows; missing resolver/provider settings intentionally degrade. |
| Vercel or Render build cannot find the package | Re-check the monorepo root settings and the service-specific `rootDir`, then use the exact commands in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

## Documentation and deployment

- [docs/API_GUIDE.md](docs/API_GUIDE.md) — executable route inventory, auth/roles,
  errors, frontend adapter boundary, and OpenAPI/client generation gate.
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) — current migration schema,
  ownership constraints, executable clinical/reminder entities, and diagram.
- [docs/LLM_PROMPTS.md](docs/LLM_PROMPTS.md) — exact versioned prompt templates,
  structured output schemas, storage, and failure behavior.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — Google OAuth/Calendar, SendGrid,
  LLM provider setup, and secret handling.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — free-tier-friendly Vercel plus
  Render/Railway-compatible API/worker topology and runbook.
- [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) — submission design (under 800 words).
- [docs/SUBMISSION_CHECKLIST.md](docs/SUBMISSION_CHECKLIST.md) — final evidence and
  reproducible source archive checklist.

## Reproducible source archive

Create the final archive only after the accepted commit is complete. `git archive`
includes committed source only, so it excludes `.git` metadata, ignored dependencies,
caches, worktrees, local `.env` files, and untracked build output:

```text
git archive --format=zip --prefix=healthcare-appointment-manager/ --output=healthcare-appointment-manager-source.zip HEAD
```

Inspect the archive with a portable listing command before sharing it:

```text
tar -tf healthcare-appointment-manager-source.zip
# or: unzip -l healthcare-appointment-manager-source.zip
```

Also verify `git ls-files` contains no `.env` other than `.env.example`. Do not create
the final zip as part of normal local validation.

## Security boundary

This repository must contain no patient data, OAuth tokens, API keys, provider payloads,
or production database exports. Use synthetic demo data only. The contracts describe
engineering controls; they are not a claim of regulatory compliance. Complete legal,
privacy, security, retention, consent, backup, and incident-response review before
accepting production healthcare data.
