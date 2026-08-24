# Healthcare API

Phase 1 provides a production-shaped FastAPI booking boundary under `/api/v1`:

- `GET /health/live` and `GET /health/ready`
- advisory doctor availability
- patient-owned hold creation, inspection, release, and confirmation
- PostgreSQL-authoritative half-open slot ownership, idempotency, outbox, and audit records

Install and validate locally with:

```text
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn healthcare_api.main:app --reload
```

The API uses a narrow overrideable actor dependency while Supabase JWT verification is
deferred to the later authentication lane.  Set `DATABASE_URL` to the local PostgreSQL
17 service from the repository root compose file.  Integration/concurrency tests require
an isolated `HEALTHCARE_TEST_DATABASE_URL` or `TEST_DATABASE_URL`.
