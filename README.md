# CareSync

### Healthcare Appointment & Follow-up Manager

CareSync connects patient booking, clinical intake, doctor workspaces, and clinic operations in one calm workflow.

**[Live app](https://healthcare-appointment-manager-eight-pi.vercel.app/)** · **[API docs](https://healthcare-api-yipa.onrender.com/api/v1/docs)** · **[System design](docs/SYSTEM_DESIGN.md)**

> Demo records are synthetic. Never enter real patient information.

## Screens

Captured from the hosted app at a fixed 1440 × 900 desktop ratio.

<p align="center">
  <img src="docs/screenshots/home.jpg" alt="CareSync landing page" width="49%" />
  <img src="docs/screenshots/patient-doctors.jpg" alt="Patient specialist directory" width="49%" />
  <img src="docs/screenshots/patient-book.jpg" alt="Appointment booking flow" width="49%" />
  <img src="docs/screenshots/patient.jpg" alt="Patient dashboard" width="49%" />
  <img src="docs/screenshots/doctor.jpg" alt="Doctor timeline" width="49%" />
  <img src="docs/screenshots/admin.jpg" alt="Clinic operations dashboard" width="49%" />
</p>

## Portals

- **Patient:** Find specialists, hold a slot for five minutes, submit symptoms, confirm or reschedule, and review care history.
- **Doctor:** Review the daily queue, compare original symptoms with the advisory AI brief, write notes, and complete visits with structured prescriptions.
- **Admin:** Manage doctors, hours, leave impact, appointments, and integration retries.
- **Reliability:** PostgreSQL conflict protection, idempotency keys, optimistic versions, durable outbox events, and graceful provider failure.

## Stack

`Next.js 15` · `FastAPI` · `SQLAlchemy` · `Alembic` · `PostgreSQL 17` · `Supabase Auth` · `uv` · `pnpm`

The API owns authorization and booking truth. Original clinical text stays authoritative; AI output is stored as advisory generated data.

## Hosted

- **Web:** [healthcare-appointment-manager-eight-pi.vercel.app](https://healthcare-appointment-manager-eight-pi.vercel.app/)
- **API:** [healthcare-api-yipa.onrender.com](https://healthcare-api-yipa.onrender.com/api/v1/health/live)
- **Data and auth:** Supabase PostgreSQL 17 and Supabase Auth

The free-tier deployment keeps email, Google Calendar, and LLM delivery safely degraded until provider credentials and a continuously running worker are enabled.

## Local setup

Requirements: Node.js 24+, pnpm 11.23.0, Python 3.13+, uv, and Docker Desktop.

```powershell
corepack pnpm install --frozen-lockfile
docker compose up -d postgres redis
Push-Location apps/api; uv sync --locked --extra dev; uv run alembic upgrade head; Pop-Location
corepack pnpm --filter @healthcare-manager/web dev
```

Run the API and worker from `apps/api` and `apps/worker` with the commands in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Copy `.env.example` to `.env`; keep secrets untracked.

## Checks

```text
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

See [docs/ACCEPTANCE_TESTS.md](docs/ACCEPTANCE_TESTS.md) for PostgreSQL 17 API and worker coverage.

## Docs

[API guide](docs/API_GUIDE.md) · [API contract](docs/API_CONTRACT.md) · [database schema](docs/DATABASE_SCHEMA.md) · [LLM prompts](docs/LLM_PROMPTS.md) · [integrations](docs/INTEGRATIONS.md) · [deployment](docs/DEPLOYMENT.md) · [submission design](docs/SYSTEM_DESIGN.md)

## Security

This is an engineering demo, not a claim of HIPAA or regulatory compliance. Complete privacy, consent, retention, backup, and incident-response review before using real healthcare data.
