"""Celery task entrypoint for validated outbox events."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any, cast

from celery import Task
from pydantic import ValidationError

from .celery_app import celery_app
from .config import get_settings
from .envelope import EventEnvelope
from .logging import safe_log
from .processor import process_envelope
from .results import ProcessingResult
from .retry import retry_policy_from_settings

LOGGER = logging.getLogger(__name__)
RawEnvelope = Mapping[str, Any] | str | bytes


def parse_envelope(raw_event: RawEnvelope) -> EventEnvelope:
    """Validate a broker JSON object without logging its contents on failure."""

    if isinstance(raw_event, bytes):
        return EventEnvelope.model_validate_json(raw_event)
    if isinstance(raw_event, str):
        return EventEnvelope.model_validate_json(raw_event)
    return EventEnvelope.model_validate(raw_event)


def invalid_envelope_result() -> ProcessingResult:
    """Return a safe terminal result for malformed or PHI-bearing input."""

    return ProcessingResult.terminal(None, error_code="INVALID_ENVELOPE")


@celery_app.task(
    bind=True,
    name="healthcare_worker.tasks.process_event",
    max_retries=10,
    ignore_result=False,
)  # type: ignore[untyped-decorator]
def process_event(self: Task, raw_event: RawEnvelope) -> dict[str, object]:
    """Process one outbox event and ask Celery for bounded redelivery when needed."""

    try:
        envelope = parse_envelope(raw_event)
    except (ValidationError, TypeError, ValueError):
        # Never include validation details: a malformed payload may contain source
        # text, and the durable outbox should retain only a normalized error code.
        result = invalid_envelope_result()
        safe_log(
            LOGGER,
            logging.WARNING,
            "event_rejected",
            fields={"error_code": result.error_code},
        )
        return cast(dict[str, object], result.model_dump(mode="json"))

    settings = get_settings()
    result = process_envelope(
        envelope,
        supported_version=settings.event_version,
        logger=LOGGER,
    )
    if not result.is_retryable:
        return cast(dict[str, object], result.model_dump(mode="json"))

    retries_already_made = int(getattr(self.request, "retries", 0))
    policy = retry_policy_from_settings(settings)
    if not policy.has_retries_remaining(retries_already_made):
        terminal = ProcessingResult.terminal(
            envelope.event_id,
            error_code="RETRY_CEILING_EXCEEDED",
            attempt=retries_already_made,
        )
        safe_log(
            LOGGER,
            logging.ERROR,
            "event_retry_exhausted",
            fields={
                "event_id": str(envelope.event_id),
                "correlation_id": envelope.correlation_id,
                "aggregate_id": str(envelope.aggregate_id),
                "event_type": envelope.event_type,
                "attempt": retries_already_made,
                "error_code": terminal.error_code,
            },
        )
        return cast(dict[str, object], terminal.model_dump(mode="json"))

    countdown = policy.delay_for(retries_already_made + 1)
    if result.retry_after_seconds is not None:
        countdown = min(
            policy.max_delay_seconds,
            max(countdown, result.retry_after_seconds),
        )
    safe_log(
        LOGGER,
        logging.WARNING,
        "event_retry_scheduled",
        fields={
            "event_id": str(envelope.event_id),
            "correlation_id": envelope.correlation_id,
            "aggregate_id": str(envelope.aggregate_id),
            "event_type": envelope.event_type,
            "attempt": retries_already_made,
            "error_code": result.error_code,
            "retry_after_seconds": countdown,
        },
    )
    # ``self.retry`` raises Celery's internal Retry exception during normal task
    # execution.  Passing the original safe envelope preserves at-least-once work.
    raise self.retry(
        args=(raw_event,),
        countdown=countdown,
        max_retries=settings.max_retries,
    )
