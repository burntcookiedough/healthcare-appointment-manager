# Background worker

Celery worker boundary for outbox processing, email, Google Calendar sync, LLM summaries, appointment reminders, and structured medication reminders.

Phase 1 keeps provider calls behind typed ports and deterministic fake adapters. The
PostgreSQL outbox remains the durable source of required work; Redis is only the
Celery transport and local deduplication is a best-effort redelivery fence.

From this directory, install the frozen environment and run the broker-free smoke
check with:

```text
uv sync
uv run python -m healthcare_worker --smoke
```

The worker process can be started later with `celery -A healthcare_worker.celery_app:celery_app worker` once a broker and durable outbox dispatcher are available.
