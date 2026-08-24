"""Envelope validation boundary, routing, and local idempotency fence."""

from __future__ import annotations

import logging

from .envelope import EventEnvelope
from .handlers import build_default_registry
from .idempotency import ClaimState, DeduplicationStore, InMemoryDeduplicationStore
from .logging import safe_event_type, safe_log
from .registry import HandlerRegistry
from .results import ProcessingOutcome, ProcessingResult

LOGGER = logging.getLogger(__name__)
DEFAULT_REGISTRY = build_default_registry()
DEFAULT_DEDUPLICATION_STORE = InMemoryDeduplicationStore()


def process_envelope(
    envelope: EventEnvelope,
    *,
    registry: HandlerRegistry | None = None,
    deduplication: DeduplicationStore | None = None,
    supported_version: int = 1,
    logger: logging.Logger = LOGGER,
) -> ProcessingResult:
    """Route one validated envelope and classify its outcome.

    The local deduplication store only prevents common redelivery races.  Durable
    outbox attempt/status updates and provider-side idempotency remain required for
    crash recovery and cross-process correctness.
    """

    if envelope.version != supported_version:
        result = ProcessingResult.terminal(
            envelope.event_id,
            error_code="UNSUPPORTED_EVENT_VERSION",
        )
        safe_log(
            logger,
            logging.WARNING,
            "event_rejected",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": safe_event_type(envelope.event_type),
                "error_code": result.error_code,
            },
        )
        return result

    resolved_registry = registry or DEFAULT_REGISTRY
    handler = resolved_registry.resolve(envelope.event_type)
    if handler is None:
        result = ProcessingResult.terminal(
            envelope.event_id,
            error_code="UNSUPPORTED_EVENT_TYPE",
        )
        safe_log(
            logger,
            logging.WARNING,
            "event_rejected",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": safe_event_type(envelope.event_type),
                "error_code": result.error_code,
            },
        )
        return result

    resolved_deduplication = deduplication or DEFAULT_DEDUPLICATION_STORE
    key = envelope.deduplication_key
    claim = resolved_deduplication.claim(key)
    if claim.state is ClaimState.ALREADY_SUCCEEDED:
        result = ProcessingResult.success(envelope.event_id, deduplicated=True)
        safe_log(
            logger,
            logging.INFO,
            "event_deduplicated",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": safe_event_type(envelope.event_type),
                "deduplicated": True,
            },
        )
        return result
    if claim.state is ClaimState.IN_FLIGHT:
        result = ProcessingResult.retryable(
            envelope.event_id,
            error_code="DEDUPLICATION_IN_FLIGHT",
        )
        safe_log(
            logger,
            logging.INFO,
            "event_deferred",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": safe_event_type(envelope.event_type),
                "error_code": result.error_code,
            },
        )
        return result

    try:
        result = handler(envelope)
    except Exception:
        # Provider ports return normalized results.  A thrown exception is not safe
        # to persist or log, so quarantine it as a terminal implementation error.
        resolved_deduplication.release(key)
        result = ProcessingResult.terminal(envelope.event_id, error_code="HANDLER_EXCEPTION")
        safe_log(
            logger,
            logging.ERROR,
            "event_handler_failed",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": safe_event_type(envelope.event_type),
                "error_code": result.error_code,
            },
        )
        return result

    if result.event_id != envelope.event_id:
        result = result.model_copy(update={"event_id": envelope.event_id})
    if result.outcome is ProcessingOutcome.SUCCEEDED:
        resolved_deduplication.mark_succeeded(key)
    else:
        resolved_deduplication.release(key)
    safe_log(
        logger,
        logging.INFO if result.is_success else logging.WARNING,
        "event_processed",
        fields={
            "event_id": str(envelope.event_id),
            "correlation_id": envelope.correlation_id,
            "aggregate_id": str(envelope.aggregate_id),
            "event_type": safe_event_type(envelope.event_type),
            "outcome": result.outcome.value,
            "error_code": result.error_code,
            "retry_after_seconds": result.retry_after_seconds,
        },
    )
    return result
