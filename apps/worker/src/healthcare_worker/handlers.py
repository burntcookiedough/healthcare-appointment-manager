"""Provider handlers built behind narrow, deterministic ports."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from .adapters import (
    DeterministicFakeClinicalLLMAdapter,
    DeterministicFakeEmailAdapter,
    DeterministicFakeGoogleCalendarAdapter,
)
from .envelope import EventEnvelope
from .events import CALENDAR_EVENT_TYPES, EMAIL_EVENT_TYPES, LLM_EVENT_TYPES
from .ports import (
    AdapterResult,
    CalendarRequest,
    ClinicalLLMPort,
    ClinicalSummaryRequest,
    EmailPort,
    EmailRequest,
    GoogleCalendarPort,
)
from .registry import EventHandler, HandlerRegistry
from .results import ProcessingOutcome, ProcessingResult


@dataclass(slots=True)
class HandlerDependencies:
    """Ports injected into handlers; all defaults are deterministic fakes."""

    email: EmailPort
    calendar: GoogleCalendarPort
    clinical_llm: ClinicalLLMPort


def default_handler_dependencies() -> HandlerDependencies:
    """Create local-only adapters for development and focused tests."""

    return HandlerDependencies(
        email=DeterministicFakeEmailAdapter(),
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )


def _processing_result(envelope: EventEnvelope, adapter_result: AdapterResult) -> ProcessingResult:
    if adapter_result.outcome is ProcessingOutcome.SUCCEEDED:
        return ProcessingResult.success(
            envelope.event_id,
            provider_reference=adapter_result.provider_reference,
        )
    if adapter_result.outcome is ProcessingOutcome.RETRYABLE_FAILURE:
        return ProcessingResult.retryable(
            envelope.event_id,
            error_code=adapter_result.error_code or "PROVIDER_TEMPORARY_FAILURE",
            retry_after_seconds=adapter_result.retry_after_seconds,
        )
    return ProcessingResult.terminal(
        envelope.event_id,
        error_code=adapter_result.error_code or "PROVIDER_TERMINAL_FAILURE",
    )


def _email_handler(dependencies: HandlerDependencies) -> EventHandler:
    def handle(envelope: EventEnvelope) -> ProcessingResult:
        try:
            request = EmailRequest.model_validate(envelope.payload.as_dict())
        except ValidationError:
            return ProcessingResult.terminal(
                envelope.event_id,
                error_code="INVALID_EVENT_PAYLOAD",
            )
        result = dependencies.email.send(request, idempotency_key=envelope.deduplication_key)
        return _processing_result(envelope, result)

    return handle


def _calendar_handler(dependencies: HandlerDependencies) -> EventHandler:
    def handle(envelope: EventEnvelope) -> ProcessingResult:
        try:
            request = CalendarRequest.model_validate(envelope.payload.as_dict())
        except ValidationError:
            return ProcessingResult.terminal(
                envelope.event_id,
                error_code="INVALID_EVENT_PAYLOAD",
            )
        result = dependencies.calendar.upsert_event(
            request,
            idempotency_key=envelope.deduplication_key,
        )
        return _processing_result(envelope, result)

    return handle


def _llm_handler(dependencies: HandlerDependencies) -> EventHandler:
    def handle(envelope: EventEnvelope) -> ProcessingResult:
        try:
            request = ClinicalSummaryRequest.model_validate(envelope.payload.as_dict())
        except ValidationError:
            return ProcessingResult.terminal(
                envelope.event_id,
                error_code="INVALID_EVENT_PAYLOAD",
            )
        result = dependencies.clinical_llm.generate_summary(
            request,
            idempotency_key=envelope.deduplication_key,
        )
        return _processing_result(envelope, result)

    return handle


def build_default_registry(
    dependencies: HandlerDependencies | None = None,
) -> HandlerRegistry:
    """Register all Phase 1 provider operations and their safe aliases."""

    resolved = dependencies or default_handler_dependencies()
    email_handler = _email_handler(resolved)
    calendar_handler = _calendar_handler(resolved)
    llm_handler = _llm_handler(resolved)
    registry = HandlerRegistry()
    for event_type in EMAIL_EVENT_TYPES:
        registry.register(event_type, email_handler)
    for event_type in CALENDAR_EVENT_TYPES:
        registry.register(event_type, calendar_handler)
    for event_type in LLM_EVENT_TYPES:
        registry.register(event_type, llm_handler)
    return registry
