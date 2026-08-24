# Infrastructure

## Local

The root [`compose.yaml`](../compose.yaml) provides disposable PostgreSQL 17 and
Redis 8-compatible services. Run migrations deliberately from `apps/api`; application
processes do not mutate schema on startup.

[`seed-demo.sql`](seed-demo.sql) inserts deterministic synthetic actors, one doctor,
and weekday working hours after migrations `0001` and `0002`. It creates no Supabase Auth
users and must never be run against a shared or hosted database. Enable the local
`AUTH_ALLOW_LOCAL_TEST_TOKENS` shortcut only while using this disposable seed.

## Hosted

The source manifests and operator runbook are:

- [`../render.yaml`](../render.yaml) — Render-compatible API web service and durable
  worker-poller service with monorepo roots and frozen `uv.lock` installs.
- [`../vercel.json`](../vercel.json) — Vercel root-monorepo install/build settings for
  the Next.js web package.
- [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — Vercel plus Render/Railway
  topology, migrations, health checks, secrets, rollback, and the explicit
  configured/not-deployed boundary.
- [`../docs/ENVIRONMENT.md`](../docs/ENVIRONMENT.md) — environment variable ownership,
  defaults, and degraded integration behavior.

No provider account, managed database/Redis instance, secret, domain, or hosted URL is
configured by this repository. Review current platform free-tier quotas before applying
a manifest.
