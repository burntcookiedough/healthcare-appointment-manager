# Background worker

Durable PostgreSQL outbox worker boundary for email, Google Calendar sync, LLM
summaries, appointment reminders, and structured medication reminders.  The
production container entrypoint is the bounded poller (`python -m
healthcare_worker --poller`); Celery remains available as a compatibility
transport for callers that still submit `process_event` tasks.

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

The Celery compatibility process can be started with
`celery -A healthcare_worker.celery_app:celery_app worker`. A hosted runtime should
assemble `build_outbox_poller` from `healthcare_worker.runtime` and run its bounded
poll loop from the production entrypoint or a dedicated dispatcher process. The
poller installs SIGINT/SIGTERM handlers, checks PostgreSQL readiness, and closes
its pool after the current bounded cycle.

Worker settings are read only from the exact `HEALTHCARE_WORKER_` environment
namespace (for example `HEALTHCARE_WORKER_DATABASE_URL` and
`HEALTHCARE_WORKER_OUTBOX_BATCH_SIZE`). Provider credentials are optional for
core booking: missing credentials produce the normalized
`PROVIDER_NOT_CONFIGURED` result and never silently select a fake adapter. Set
`HEALTHCARE_WORKER_LLM_PROVIDER=none` (or `disabled`) to explicitly disable LLM
work. `--poller-dry-run` validates the process wiring without opening PostgreSQL
or contacting a provider.

The API event boundary currently covers `appointment.confirmed` (email + calendar
projection), `appointment.calendar_sync` (calendar projection), and the stable
`email.notification`, `appointment.reminder`, `medication.reminder`, `calendar.sync`,
and `clinical.llm.summary` operations. New API event names must be added to the
explicit translation map and contract tests before deployment.

Clinical LLM payloads use the canonical task kinds `pre_visit`, `post_visit`, and
`plain_language_summary`. The two legacy API spellings `pre_visit_brief` and
`post_visit_summary` are explicitly translated during rollout; other values are
terminal invalid payloads and are never logged.
