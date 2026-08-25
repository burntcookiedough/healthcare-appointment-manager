"""Production runtime assembly kept separate from deterministic task tests."""

from __future__ import annotations

from .adapters import HttpTransport
from .config import WorkerSettings
from .envelope import EventEnvelope
from .handlers import build_default_registry, production_handler_dependencies
from .llm import PostgresSummaryRepository
from .outbox import OutboxPoller, PostgresOutboxStore
from .ports import TrustedDataResolver
from .processor import process_envelope_async
from .registry import HandlerRegistry
from .reminders import MedicationReminderDispatcher, ReminderOccurrenceStore
from .resolver import PostgresTrustedDataResolver
from .results import ProcessingResult
from .retry import retry_policy_from_settings


async def build_outbox_poller(
    settings: WorkerSettings,
    *,
    resolver: TrustedDataResolver | None = None,
    transport: HttpTransport | None = None,
    reminder_store: ReminderOccurrenceStore | None = None,
) -> tuple[OutboxPoller, PostgresOutboxStore, HandlerRegistry]:
    """Assemble durable store, trusted resolver, configured adapters, and poller.

    When no test resolver is injected, the production path binds a PostgreSQL
    resolver to the outbox store's shared async pool.  The pool remains owned by
    the returned store and is closed by the process entrypoint.
    """

    if not settings.database_url:
        raise RuntimeError("HEALTHCARE_WORKER_DATABASE_URL is required for outbox polling")
    store = await PostgresOutboxStore.from_dsn(settings.database_url)
    resolved_resolver = resolver or PostgresTrustedDataResolver(store.pool)
    try:
        dependencies = production_handler_dependencies(
            settings,
            resolver=resolved_resolver,
            transport=transport,
            summary_repository=PostgresSummaryRepository(store.pool),
        )
        if reminder_store is not None:
            dependencies.medication_reminders = MedicationReminderDispatcher(
                resolver=resolved_resolver,
                email=dependencies.email,
                occurrence_store=reminder_store,
            )
        registry = build_default_registry(dependencies)

        async def processor(envelope: EventEnvelope) -> ProcessingResult:
            bind = getattr(resolved_resolver, "bind", None)
            if callable(bind):
                async with bind(envelope):
                    return await process_envelope_async(
                        envelope,
                        registry=registry,
                        supported_version=settings.event_version,
                    )
            return await process_envelope_async(
                envelope,
                registry=registry,
                supported_version=settings.event_version,
            )

        poller = OutboxPoller(
            store,
            processor,
            max_concurrency=settings.max_concurrency,
            batch_size=settings.outbox_batch_size,
            lease_seconds=settings.outbox_lease_seconds,
            poll_interval_seconds=settings.outbox_poll_interval_seconds,
            retry_policy=retry_policy_from_settings(settings),
        )
    except BaseException:
        await store.close()
        raise
    return poller, store, registry
