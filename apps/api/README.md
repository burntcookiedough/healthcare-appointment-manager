# Healthcare API

The API provides a production-shaped FastAPI booking and follow-up boundary under `/api/v1`:

- `GET /health/live` and `GET /health/ready`
- advisory doctor availability
- patient-owned hold creation, inspection, release, and confirmation
- role-isolated profiles, doctors, working hours, leave, appointments, visits,
  structured prescriptions, reminders, generated-artifact state, and integrations
- PostgreSQL-authoritative half-open slot ownership, idempotency, outbox, and audit records

Install and validate locally with:

```text
uv sync --extra dev
uv run alembic upgrade head
uv run uvicorn healthcare_api.main:app --reload
```

Bearer authentication verifies a configured Supabase-compatible JWT (signature, issuer,
audience, and lifetime) and fails closed when verification settings are absent. A
`test:<subject>` shortcut is available only when `AUTH_ALLOW_LOCAL_TEST_TOKENS=true` and
`APP_ENV` is `local`, `development`, or `test`. Set `DATABASE_URL` to the local PostgreSQL
17 service from the repository root compose file. Integration/concurrency tests require
an isolated `HEALTHCARE_TEST_DATABASE_URL` or `TEST_DATABASE_URL`.
