# Healthcare Appointment & Follow-up Manager

Contract-first monorepo for a healthcare scheduling and follow-up system serving
patients, doctors, and administrators. The current source snapshot contains a
working Phase 1 booking/API and worker foundation plus a mocked Next.js frontend.
It is not a hosted service and it must be exercised with synthetic data only.

## What is shipped in this snapshot

| Area | Current state |
| --- | --- |
| Web | Mocked patient, doctor, and admin experience in `apps/web`; the UI uses typed fixtures until the OpenAPI/client gate is complete. |
| API | FastAPI process with `/api/v1/health/live`, `/api/v1/health/ready`, advisory doctor availability, patient-owned holds, hold release, and hold confirmation. |
| Database | PostgreSQL 17 migration `0001_booking_foundation` with actors, profiles, doctors, schedules, leave, holds, appointments, idempotency, outbox, and immutable audit events. |
| Worker | Celery/Redis transport boundary with safe versioned envelopes, deterministic fake adapters, bounded retry policy, and PHI-minimizing logs. Real SendGrid, Google Calendar, and LLM adapters are not wired yet. |
| Remaining API contract | Doctor administration, leave application, visits, prescriptions, reminders, integration health, and production Supabase JWT verification remain with the concurrent API completion lanes. See [docs/API_GUIDE.md](docs/API_GUIDE.md). |

No hosted URL, production credential, provider account, or deployment is claimed by
this repository.

## Repository map

- `apps/web` — Next.js frontend owned by the Gemini Antigravity lane.
- `apps/api` — FastAPI API, SQLAlchemy models, Alembic migrations, and API tests.
- `apps/worker` — Celery worker, event envelope, adapters, retry, and worker tests.
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

The seed is local-only and contains no Supabase users. In the current Phase 1 auth
boundary, use the seeded subject values as a bearer token (`demo.patient`,
`demo.doctor`, or `demo.admin`) for local API smoke checks. Production must use the
Supabase JWT path when that lane is integrated; never use these demo tokens outside a
disposable local database.

## Run the applications

Run each process in a separate terminal from the repository root.

### Web (port 3000)

```text
pnpm --filter @healthcare-manager/web dev
```

The browser-safe `NEXT_PUBLIC_API_URL` defaults to
`http://localhost:8000/api/v1`. The current web app intentionally uses mocked data
for routes not yet backed by the generated client.

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

The Phase 1 worker has no durable PostgreSQL outbox dispatcher yet and defaults to
deterministic fake provider adapters. A running worker therefore demonstrates the
transport/handler boundary, not a production email, calendar, or LLM integration.

## Tests and checks

JavaScript workspace checks use the frozen pnpm lockfile:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The API unit suite does not require PostgreSQL:

```text
cd apps/api
uv run pytest tests/test_unit_contracts.py
```

The API PostgreSQL/concurrency suite requires a disposable database URL. It is
skipped unless `HEALTHCARE_TEST_DATABASE_URL` or `TEST_DATABASE_URL` is set, and the
fixture drops/truncates only that test database:

```text
cd apps/api
uv run pytest tests/test_booking_postgres.py
```

The worker suite uses deterministic fakes and no provider network calls:

```text
cd apps/worker
uv run pytest
```

Run `uv run ruff check src tests` (and `uv run mypy` where configured) in each Python
application before submitting changes. Hosted CI runs the same frozen-install checks;
it does not provision PostgreSQL, Redis, OAuth, SendGrid, or an LLM provider.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `connection refused` on port 5432/6379 | Run `docker compose ps`; inspect `docker compose logs postgres redis`; wait for the health checks before migrating. |
| Alembic cannot connect | Confirm the root `.env` `DATABASE_URL` uses `postgresql+asyncpg://` and run the command from `apps/api`. |
| `401 AUTHENTICATION_REQUIRED` locally | Load `infra/seed-demo.sql` and use the exact seeded subject as the bearer token. Supabase JWT verification is not part of this Phase 1 boundary. |
| Hold returns `SLOT_CONFLICT` | Availability is advisory. Check the doctor ID, UTC offset, configured duration, working hours, leave, and other active holds/appointments. Retry with a new idempotency key only for a new user intent. |
| Hold returns `HOLD_EXPIRED` | The server/database clock owns expiry. Create a new hold; do not extend a client countdown. |
| Worker starts but no provider call occurs | Phase 1 uses fake adapters and has no durable outbox dispatcher. Verify the Celery process and event envelope tests instead of expecting an external side effect. |
| Vercel or Render build cannot find the package | Re-check the monorepo root settings and the service-specific `rootDir`, then use the exact commands in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

## Documentation and deployment

- [docs/API_GUIDE.md](docs/API_GUIDE.md) — executable routes, contract-only routes,
  roles, errors, examples, and OpenAPI/client generation gate.
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) — current migration schema,
  ownership constraints, planned clinical/reminder entities, and diagram.
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

Before sharing it, verify `git ls-files` contains no `.env` other than `.env.example`
and inspect the archive listing. Do not create the final zip as part of normal local
validation.

## Security boundary

This repository must contain no patient data, OAuth tokens, API keys, provider payloads,
or production database exports. Use synthetic demo data only. The contracts describe
engineering controls; they are not a claim of regulatory compliance. Complete legal,
privacy, security, retention, consent, backup, and incident-response review before
accepting production healthcare data.
