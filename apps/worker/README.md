# Background worker

Celery worker boundary for outbox processing, email, Google Calendar sync, LLM summaries, appointment reminders, and structured medication reminders.

The worker claims the API's `outbox_events` rows transactionally with
`FOR UPDATE SKIP LOCKED`. `processing` rows use `next_attempt_at` as a lease expiry;
the persisted `attempt_count` is also a fencing token, so a recovered worker cannot
overwrite a newer claim. Retryable and terminal outcomes are persisted without
deleting the original intent. Redis is only the Celery transport and local
deduplication is a best-effort redelivery fence.

Provider calls are behind typed ports. Fakes are deterministic and the configured
SendGrid, Google Calendar OAuth2, and provider-neutral structured-output LLM adapters
return `PROVIDER_NOT_CONFIGURED` when required credentials or trusted reference
resolvers are absent. Outbox payloads contain opaque references only; the runtime
resolver must fetch recipient content, OAuth access tokens, source notes, and
structured prescription fields from the trusted database boundary.

From this directory, install the frozen environment and run the broker-free smoke
check with:

```text
uv sync
uv run python -m healthcare_worker --smoke
```

Process-manager probes are broker-free:

```text
uv run python -m healthcare_worker --health-live
uv run python -m healthcare_worker --health-ready
```

`--health-ready` checks PostgreSQL only when
`HEALTHCARE_WORKER_DATABASE_URL` is configured. It returns a coarse `ok` or
`unavailable` response and never exposes dependency details.

The Celery process can be started with
`celery -A healthcare_worker.celery_app:celery_app worker`. A hosted runtime should
assemble `build_outbox_poller` from `healthcare_worker.runtime` and run its bounded
poll loop alongside Celery or from a dedicated dispatcher process.

The API event boundary currently covers `appointment.confirmed` (email + calendar
projection), `appointment.calendar_sync` (calendar projection), and the stable
`email.notification`, `appointment.reminder`, `medication.reminder`, `calendar.sync`,
and `clinical.llm.summary` operations. New API event names must be added to the
explicit translation map and contract tests before deployment.
