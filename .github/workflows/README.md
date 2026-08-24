# Continuous integration

[`ci.yml`](ci.yml) runs on pushes and pull requests with Node 24, Corepack/pnpm
11.23.0, Python 3.13, and frozen `uv` environments. The web job runs lint, typecheck,
tests, and build. API and worker jobs run Ruff lint/format checks, mypy, bytecode
compilation, and tests.

The API PostgreSQL job starts PostgreSQL 17, applies Alembic `head` from an empty
database, sets `HEALTHCARE_TEST_DATABASE_URL`, and runs the complete API suite so
integration tests cannot be silently skipped. The worker job also runs with a
PostgreSQL URL configured and exercises the durable-poller/lease tests without provider
credentials. No hosted services or real provider requests are used.
