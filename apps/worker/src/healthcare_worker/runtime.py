"""Production runtime assembly kept separate from deterministic task tests."""

from __future__ import annotations

from .adapters import HttpTransport
from .config import WorkerSettings
from .envelope import EventEnvelope
from .handlers import build_default_registry, production_handler_dependencies
from .outbox import OutboxPoller, PostgresOutboxStore
from .ports import TrustedDataResolver
from .processor import process_envelope
from .registry import HandlerRegistry
from .reminders import MedicationReminderDispatcher, ReminderOccurrenceStore
from .results import ProcessingResult
from .retry import retry_policy_from_settings


async def build_outbox_poller(
    settings: WorkerSettings,
    *,
    resolver: TrustedDataResolver | None,
    transport: HttpTransport | None = None,
    reminder_store: ReminderOccurrenceStore | None = None,
) -> tuple[OutboxPoller, PostgresOutboxStore, HandlerRegistry]:
    """Assemble durable store, configured adapters, and a bounded poller."""

    if not settings.database_url:
        raise RuntimeError("HEALTHCARE_WORKER_DATABASE_URL is required for outbox polling")
    store = await PostgresOutboxStore.from_dsn(settings.database_url)
    dependencies = production_handler_dependencies(settings, resolver=resolver, transport=transport)
    if resolver is not None and reminder_store is not None:
        dependencies.medication_reminders = MedicationReminderDispatcher(
            resolver=resolver,
            email=dependencies.email,
            occurrence_store=reminder_store,
        )
    registry = build_default_registry(dependencies)

    def processor(envelope: EventEnvelope) -> ProcessingResult:
        return process_envelope(
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
    return poller, store, registry
