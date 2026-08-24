# Deployment runbook

This is a deployment procedure and source-manifest description, not evidence of a
deployment. No Vercel, Render, Railway, Supabase, Redis, Google, SendGrid, or LLM
account, secret, custom domain, or hosted URL is configured in this repository. Use
synthetic data until privacy, security, consent, and production-readiness review is
complete.

## Current topology

```text
Vercel (Next.js web; browser-safe config)
        | HTTPS + Supabase access token
        v
Render/Railway FastAPI API ----------------------> PostgreSQL 17 (system of record)
        |                                             ^
        +-- atomic outbox_events --------------------|
                                                      |
Render/Railway durable worker poller -----------------+
        |                 |
        +--> SendGrid / Google Calendar / LLM adapters
        |
        +--> Redis/Celery (optional transport; never durable authority)
```

The API and worker must run compatible source/migration commits. PostgreSQL owns
appointments, holds, schedules, leave, clinical source versions, prescriptions, reminder
occurrences, outbox rows, integration state, history, and audit events. A provider outage
therefore changes only a projection status, never committed scheduling or clinical truth.

## Source manifests and boundaries

- [`vercel.json`](../vercel.json) uses the root workspace lockfile and Corepack pnpm to
  build `@healthcare-manager/web`.
- [`render.yaml`](../render.yaml) declares a Python API service at `apps/api` and a
  worker at `apps/worker`. The worker start command is
  `uv run python -m healthcare_worker --poll-outbox`, an assumption that the concurrent
  worker lane must reconcile against its final package CLI before deployment.
- [`.env.example`](../.env.example) and [`ENVIRONMENT.md`](ENVIRONMENT.md) use exact API
  and `HEALTHCARE_WORKER_*` names. They contain placeholders only.
- `compose.yaml` is local-only PostgreSQL 17 plus Redis 8-compatible infrastructure;
  it does not provision a hosted service or run migrations automatically.
- Alembic `0001_booking_foundation` and `0002_application_domain` are executable. Run
  `uv run alembic upgrade head` once from the API release environment before traffic.

The worker package's durable poller claims PostgreSQL `outbox_events` with bounded batch,
lease, fencing, retry, and concurrency settings. Celery smoke/start commands are useful
for transport checks but must not be presented as the only outbox drain. The current
runtime factory has no trusted-data resolver, so SendGrid/Calendar/LLM operations remain
explicitly degraded (`PROVIDER_NOT_CONFIGURED` or equivalent) until that resolver is
provided by a reviewed worker lane.

## Pre-deploy gates

1. Verify the exact release commit, clean tracked state, and delegated changed-file scope.
2. Run the frozen JavaScript checks: `corepack pnpm install --frozen-lockfile`, web lint,
   typecheck, tests, and build.
3. In both Python applications run locked sync, Ruff lint/format, mypy, bytecode
   compilation, and tests. API tests must run with an isolated PostgreSQL 17 URL so no
   integration test is skipped; apply `alembic upgrade head` from an empty database first.
4. Validate YAML/JSON/Compose, docs links, environment-key coverage, and secret scans.
5. Create private PostgreSQL/Redis services, backups, TLS/private networking, and
   least-privilege credentials in provider dashboards. Keep API, migration, worker, and
   provider credentials separate.
6. Provision Supabase JWT verification values (`SUPABASE_JWT_PUBLIC_KEY`, issuer,
   audience) and set `AUTH_ALLOW_LOCAL_TEST_TOKENS=false`. Never use demo subjects in
   hosted production.
7. Review the runtime OpenAPI JSON, web adapter request/response shapes, CORS allowlist,
   OAuth callback allowlists, and provider degraded behavior before exposing the web app.

## Vercel setup

1. Create a Vercel project from the repository and set its Root Directory to the
   repository root so `pnpm-workspace.yaml` and `pnpm-lock.yaml` are visible.
2. Keep the Next.js framework and use the committed install/build commands. Set exactly
   one public API URL form (`NEXT_PUBLIC_API_URL` including `/api/v1`, or
   `NEXT_PUBLIC_API_BASE_URL` as the origin) for each environment.
3. Set Supabase URL/anon key only as browser-safe values. Never add database, Redis,
   OAuth-client-secret, SendGrid, LLM, or JWT-verification secrets to Vercel client env.
4. With `NEXT_PUBLIC_DEMO_MODE=false`, the web adapter sends bearer-authenticated HTTP
   requests and exposes API error/integration state. With it `true`, the UI uses explicit
   deterministic fixtures and does not represent hosted records.
5. Confirm API CORS allows only the intended Vercel origin. No domain is recorded here.

## Render setup

Render's current plan/region quotas change; review them before applying the Blueprint.
The worker uses a `starter` placeholder because a free background-worker plan is not
assumed.

1. Create a Blueprint and inspect both services. API `rootDir` is `apps/api`; worker
   `rootDir` is `apps/worker`.
2. Add API `DATABASE_URL`, Supabase JWT values, and any reviewed provider settings as
   Render secrets. Add the worker's exact `HEALTHCARE_WORKER_DATABASE_URL`,
   `HEALTHCARE_WORKER_OUTBOX_POLL_INTERVAL_SECONDS`,
   `HEALTHCARE_WORKER_OUTBOX_BATCH_SIZE`, `HEALTHCARE_WORKER_OUTBOX_LEASE_SECONDS`,
   `HEALTHCARE_WORKER_MAX_CONCURRENCY`, and
   `HEALTHCARE_WORKER_PROVIDER_TIMEOUT_SECONDS` values, plus the prefixed
   `HEALTHCARE_WORKER_SENDGRID_*`, `HEALTHCARE_WORKER_GOOGLE_*`, and
   `HEALTHCARE_WORKER_LLM_*` provider settings. Do not duplicate broad credentials
   between services; see [`ENVIRONMENT.md`](ENVIRONMENT.md) for the complete matrix.
3. Build with each service's frozen `uv.lock`. Render supplies `$PORT` to the API start
   command. The worker command must be the worker package's durable poller CLI, not only
   `celery ... worker`.
4. From a one-time release shell using the API environment, run
   `uv run alembic upgrade head` and record the revision plus backup/restore point. Never
   have every API/worker process run migrations at startup.
5. Probe `/api/v1/health/live` for process liveness, then `/api/v1/health/ready` for
   PostgreSQL readiness. A `503` is a data-service failure, not a reason to hide health.
6. Inspect safe worker JSON logs for poll claims, lease recovery, retry/terminal state,
   and provider degradation. Verify an outbox row transitions without changing its
   appointment when an adapter is unavailable.
7. Run a synthetic doctor/availability/hold/confirm smoke flow and verify appointment,
   audit, and outbox rows in PostgreSQL. Do not send real provider traffic until consent
   and provider review are complete.

## Railway-compatible native deployment

Railway can use the same roots and commands without the Blueprint:

- API root `apps/api`; build `pip install uv && uv sync --locked --extra dev`; start
  `uv run uvicorn healthcare_api.main:app --host 0.0.0.0 --port $PORT`.
- Worker root `apps/worker`; build `pip install uv && uv sync --locked`; start the
  worker-package poller command from the current `render.yaml` assumption and reconcile
  its option against the worker commit before release.
- Attach isolated PostgreSQL 17 and Redis services; map the exact names in
  [`ENVIRONMENT.md`](ENVIRONMENT.md), including `HEALTHCARE_WORKER_DATABASE_URL`.
- Run the migration once, configure private worker networking, and allow only the Vercel
  origin in API CORS. Railway plan/free-tier terms change; verify current quotas.

## Rollback and operations

- Roll back API and worker only to a source commit whose migrations are compatible with
  the database. Do not move Alembic history backward without backup/recovery approval.
- Preserve build logs, migration output, health responses, and normalized provider error
  codes. Redact tokens and PHI.
- Monitor API latency/errors, PostgreSQL conflicts, pending outbox age/depth, claim/lease
  recovery, retry/terminal counts, worker liveness, reminder lateness, and Calendar drift.
- Before accepting healthcare data, complete access review, encryption/key rotation,
  consent, retention/deletion/export, backup/restore, disaster recovery, incident
  response, and formal security/privacy review.
