# Deployment runbook

This is a deployment-ready description, not evidence of a deployment. There is no
hosted URL, provisioned database, Redis instance, OAuth client, SendGrid account, LLM
key, or platform secret in this repository. Use synthetic data until privacy/security
and production-readiness review is complete.

## Target topology

```text
Vercel (Next.js web)
        | HTTPS, browser-safe NEXT_PUBLIC_API_URL
        v
Render or Railway (FastAPI API) ---- private TLS ----> Supabase PostgreSQL/Auth
        |
        +---- durable outbox intent ----> managed Redis (Upstash or equivalent)
                                             |
Render or Railway (Celery worker) ------------+
        |              |                 |
     SendGrid     Google Calendar       LLM provider
```

The database owns appointments, holds, schedules, clinical records, generated-artifact
metadata, reminders, outbox state, and audit records. Redis is a transport/coordination
layer only. A Vercel project is separate from the API/worker services. Supabase and
Upstash are the free-tier-friendly managed data choices in [PLAN.md](../PLAN.md); an
operator may substitute equivalent PostgreSQL/Redis services with TLS and backups.

## What is configured in source

- [`vercel.json`](../vercel.json) contains a root-monorepo install/build command for
  `pnpm 11.23.0` and the `apps/web` package.
- [`render.yaml`](../render.yaml) describes a Python API web service and a Celery
  worker with `apps/api` and `apps/worker` roots, frozen `uv.lock` installs, API
  liveness health check, and explicit secret placeholders.
- [`.env.example`](../.env.example) documents safe local/hosted variable names.
- The API exposes `/api/v1/health/live` and PostgreSQL-backed
  `/api/v1/health/ready`.
- Alembic migration `0001_booking_foundation` is committed; migrations are run as a
  deliberate release step, not by every process at startup.
- The worker has a documented Celery command and broker-free `--smoke` check.

## Not configured or not deployed

- Vercel, Render, Railway, Supabase, Upstash, Google, SendGrid, or LLM accounts.
- Production environment values, custom domains, CORS allowlists, OAuth callbacks,
  webhook/reconciliation jobs, encryption keys, backups, alerting, CI secrets, or
  hosted URLs.
- A committed/reviewed OpenAPI artifact and generated Orval client.
- Durable PostgreSQL outbox dispatcher and real provider adapters.
- The clinical visits/prescriptions/generated-artifacts/reminder migrations and their
  completion-lane API routes.
- Production Supabase JWT verification and administrator provisioning.

Do not remove these caveats from a submission simply because a platform accepts a
placeholder manifest.

## Pre-deploy gates

1. Verify the exact release commit, clean tracked state, and changed-file scope.
2. Run JavaScript frozen checks: `pnpm install --frozen-lockfile`, lint, typecheck,
   tests, and build.
3. Run API and worker frozen checks: `uv sync --locked` (API with `--extra dev`),
   Ruff, unit tests, and worker tests. Run PostgreSQL concurrency tests against an
   isolated database URL.
4. Confirm the reviewed OpenAPI/client and clinical migrations have landed if deploying
   beyond the Phase 1 routes. Do not expose contract-only endpoints by configuration.
5. Create managed PostgreSQL/Redis databases, private connections, backups, and
   least-privilege credentials in the provider dashboards. Keep all values in secret
   stores.
6. Configure Supabase Auth only when the JWT/auth lane is integrated. Add exact web/API
   origins and OAuth callback URLs; do not use local demo bearer subjects in hosted
   environments.

## Vercel setup

1. Create a Vercel project from the repository without claiming a production domain.
2. Set the project **Root Directory** to the repository root so the root
   `pnpm-lock.yaml` and workspace are visible. Keep the framework as Next.js.
3. Add `NEXT_PUBLIC_API_URL` for Preview and Production separately. Add Supabase
   browser-safe values only after the auth lane is ready; never add server secrets.
4. Review the build log for the frozen install and
   `corepack pnpm --filter @healthcare-manager/web build`. Preview deployments may show mocked
   screens where the generated API client is not yet wired.
5. Verify the browser can reach the API HTTPS origin and that API CORS allows only the
   intended Vercel origin. No URL is recorded here because none is deployed.

The committed `vercel.json` uses Corepack so the root `packageManager` field selects
pnpm 11.23.0 instead of an older platform default. It deliberately does not rewrite
API traffic or embed a secret. Configure the project domain and environment values in
Vercel, not in source.

## Render deployment

The Blueprint is a starting point; inspect current Render plan/region availability
before applying it. Render's current Blueprint rules allow a free web service but do
not offer a free background-worker plan, so the checked-in worker entry uses the
lowest `starter` tier placeholder. If a free worker or credit is available on Railway,
use the same `uv`/ Celery commands there; otherwise budget the worker separately rather
than silently treating a paid plan as free.

1. Create a Render Blueprint from the repository and review both services before
   applying. API `rootDir` is `apps/api`; worker `rootDir` is `apps/worker`.
2. Provide the API `DATABASE_URL`, `SUPABASE_URL`, and later provider secrets as
   Render secret values. Provide the worker
   `HEALTHCARE_WORKER_BROKER_URL` and any provider credentials separately. Do not
   duplicate broad credentials between services.
3. Build uses `pip install uv && uv sync --locked`; start uses Uvicorn for the API and
   Celery for the worker. Render supplies `PORT` to the API command.
4. Before the first traffic, run the migration once from a release shell using the API
   environment: `uv run alembic upgrade head`. Record the migration revision and
   database backup/restore point. Never run migrations concurrently from every worker.
5. Wait for `GET /api/v1/health/live` to return `200 {"status":"ok"}`. Then verify
   `GET /api/v1/health/ready` returns `200 {"status":"ok"}`; a `503` is a data-service
   readiness failure, not a reason to hide it behind a proxy.
6. Start the worker and inspect safe JSON logs for task registration, broker
   connection, retry, and terminal outcomes. The Phase 1 worker still uses fakes and
   has no durable outbox dispatcher.
7. Run a synthetic availability/hold/confirm smoke test and verify appointment/outbox
   state in PostgreSQL. Do not send a real notification until provider setup and
   consent review are complete.

## Railway-compatible deployment

Railway can use the same two service roots and commands without the Blueprint:

- API root: `apps/api`; build `pip install uv && uv sync --locked --extra dev`;
  start `uv run uvicorn healthcare_api.main:app --host 0.0.0.0 --port $PORT`.
- Worker root: `apps/worker`; build `pip install uv && uv sync --locked`; start
  `uv run celery -A healthcare_worker.celery_app:celery_app worker --loglevel=INFO`.
- Attach a managed PostgreSQL and Redis service or external Supabase/Upstash URLs.
  Map the same environment names in [`ENVIRONMENT.md`](ENVIRONMENT.md).
- Run `uv run alembic upgrade head` once from an API release shell before health
  readiness is considered complete. Keep API and worker on the same source commit.
- Configure a public API health probe at `/api/v1/health/live`, private worker
  networking, and an allowlist for the Vercel origin.

Railway plan names and free quotas change; verify current account limits before
authorizing a deployment. The source manifest remains Render-compatible and does not
claim that either platform is currently connected.

## Rollback and operations

- Roll back the API/worker to the last source commit only when its migration compatibility
  is verified. Do not move a migration revision backward without an explicit recovery
  plan and database backup.
- A provider outage is handled by outbox retry/terminal state; do not mark the
  appointment failed to make a dashboard green.
- Preserve failed build logs, migration output, health responses, and provider error
  codes for incident review. Redact tokens and PHI.
- Monitor API latency/errors, database conflicts, pending outbox age, worker liveness,
  retry/terminal counts, reminder lateness, and Calendar drift.
- Before production healthcare data, complete access reviews, encryption/key rotation,
  consent, retention/deletion/export, backup/restore, disaster recovery, incident
  response, and formal security/privacy review.
