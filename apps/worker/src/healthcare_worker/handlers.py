"""Provider handlers, API-event translation, and generated-summary persistence."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from .adapters import (
    DeterministicFakeClinicalLLMAdapter,
    DeterministicFakeEmailAdapter,
    DeterministicFakeGoogleCalendarAdapter,
    GoogleCalendarOAuthAdapter,
    HttpClinicalLLMAdapter,
    HttpTransport,
    SendGridEmailAdapter,
)
from .config import WorkerSettings
from .envelope import EventEnvelope
from .events import API_EVENT_TYPES, CALENDAR_EVENT_TYPES, EMAIL_EVENT_TYPES, LLM_EVENT_TYPES
from .llm import (
    GeneratedSummaryRecord,
    InMemorySummaryRepository,
    PromptMetadata,
    SummaryRepository,
    output_model_for_task,
)
from .ports import (
    AdapterResult,
    CalendarRequest,
    ClinicalLLMPort,
    ClinicalSummaryRequest,
    EmailPort,
    EmailRequest,
    GoogleCalendarPort,
    TrustedDataResolver,
)
from .registry import EventHandler, HandlerRegistry
from .reminders import MedicationReminderDispatcher, MedicationReminderRequest
from .results import ProcessingOutcome, ProcessingResult


@dataclass(slots=True)
class HandlerDependencies:
    """Ports injected into handlers; local defaults are deterministic and inert."""

    email: EmailPort
    calendar: GoogleCalendarPort
    clinical_llm: ClinicalLLMPort
    summary_repository: SummaryRepository | None = None
    medication_reminders: MedicationReminderDispatcher | None = None


def default_handler_dependencies() -> HandlerDependencies:
    """Create local-only adapters for development and focused tests."""

    return HandlerDependencies(
        email=DeterministicFakeEmailAdapter(),
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
        summary_repository=InMemorySummaryRepository(),
    )


def production_handler_dependencies(
    settings: WorkerSettings,
    *,
    resolver: TrustedDataResolver | None,
    transport: HttpTransport | None = None,
) -> HandlerDependencies:
    """Build configured adapters; each provider is fail-closed when incomplete."""

    return HandlerDependencies(
        email=SendGridEmailAdapter(
            api_key=settings.secret_value(settings.sendgrid_api_key),
            from_email=settings.sendgrid_from_email,
            resolver=resolver,
            endpoint=settings.sendgrid_endpoint,
            timeout_seconds=settings.provider_timeout_seconds,
            transport=transport,
        ),
        calendar=GoogleCalendarOAuthAdapter(
            client_id=settings.google_client_id,
            client_secret=settings.secret_value(settings.google_client_secret),
            resolver=resolver,
            endpoint=settings.google_calendar_endpoint,
            timeout_seconds=settings.provider_timeout_seconds,
            transport=transport,
        ),
        clinical_llm=HttpClinicalLLMAdapter(
            endpoint=settings.llm_endpoint,
            api_key=settings.secret_value(settings.llm_api_key),
            provider=settings.llm_provider,
            model=settings.llm_model,
            resolver=resolver,
            prompt_version=settings.llm_prompt_version,
            schema_version=settings.llm_schema_version,
            timeout_seconds=settings.provider_timeout_seconds,
            validation_retries=settings.llm_validation_retries,
            transport=transport,
        ),
        summary_repository=InMemorySummaryRepository(),
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
            request = EmailRequest.model_validate(envelope.safe_payload.as_dict())
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
        payload = envelope.safe_payload.as_dict()
        # Older API cancellation rows carried a cancellation label but omitted
        # the now-canonical action field.  Translate that explicit legacy shape
        # to delete; a missing provider reference is handled fail-closed by the
        # real adapter's trusted resolver and can never become a create.
        if "action" not in payload and "operation" not in payload:
            label = payload.get("event_label")
            if isinstance(label, str) and "cancellation" in label.casefold():
                payload["action"] = "delete"
        try:
            request = CalendarRequest.model_validate(payload)
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
            request = ClinicalSummaryRequest.model_validate(envelope.safe_payload.as_dict())
        except ValidationError:
            return ProcessingResult.terminal(
                envelope.event_id,
                error_code="INVALID_EVENT_PAYLOAD",
            )
        result = dependencies.clinical_llm.generate_summary(
            request,
            idempotency_key=envelope.deduplication_key,
        )
        if result.outcome is not ProcessingOutcome.SUCCEEDED:
            return _processing_result(envelope, result)
        if (
            result.output is None
            or request.source_record_reference is None
            or request.source_version is None
        ):
            return ProcessingResult.terminal(envelope.event_id, error_code="LLM_OUTPUT_MISSING")
        repository = dependencies.summary_repository
        if repository is None:
            return ProcessingResult.terminal(
                envelope.event_id, error_code="SUMMARY_REPOSITORY_UNAVAILABLE"
            )
        metadata_values = result.metadata or {}
        try:
            output_model = output_model_for_task(request.task_kind)
            output = output_model.model_validate(result.output)
            metadata = PromptMetadata(
                task_kind=request.task_kind,
                prompt_version=metadata_values.get("prompt_version", request.prompt_version),
                schema_version=metadata_values.get("schema_version", request.schema_version),
                provider=metadata_values.get("provider", "unknown"),
                model=metadata_values.get("model", "unknown"),
            )
            record = GeneratedSummaryRecord(
                source_record_reference=request.source_record_reference,
                source_version=request.source_version,
                task_kind=request.task_kind,
                metadata=metadata,
                output=output,
            )
            repository.persist_summary(record)
        except (ValidationError, ValueError, TypeError):
            return ProcessingResult.terminal(envelope.event_id, error_code="LLM_INVALID_OUTPUT")
        except Exception:
            return ProcessingResult.retryable(
                envelope.event_id,
                error_code="SUMMARY_PERSISTENCE_ERROR",
            )
        return _processing_result(envelope, result)

    return handle


def _appointment_confirmed_handler(dependencies: HandlerDependencies) -> EventHandler:
    """Translate the API's combined confirmation event into two projections."""

    def handle(envelope: EventEnvelope) -> ProcessingResult:
        payload = envelope.safe_payload.as_dict()
        raw_channels = payload.get("channels", ["email", "calendar"])
        channels = (
            {str(value) for value in raw_channels} if isinstance(raw_channels, list) else set()
        )
        if not channels or not channels.issubset({"email", "calendar"}):
            return ProcessingResult.terminal(envelope.event_id, error_code="INVALID_EVENT_PAYLOAD")
        appointment_id = payload.get("appointment_id", str(envelope.aggregate_id))
        try:
            appointment_uuid = UUID(str(appointment_id))
        except (TypeError, ValueError):
            return ProcessingResult.terminal(envelope.event_id, error_code="INVALID_EVENT_PAYLOAD")
        results: list[ProcessingResult] = []
        if "email" in channels:
            email_payload: dict[str, Any] = {
                "appointment_id": str(appointment_uuid),
                "template_key": "appointment_confirmed",
                "recipient_reference": payload.get("recipient_reference"),
                "locale": payload.get("locale", "en"),
            }
            try:
                email_request = EmailRequest.model_validate(email_payload)
            except ValidationError:
                return ProcessingResult.terminal(
                    envelope.event_id, error_code="INVALID_EVENT_PAYLOAD"
                )
            email_result = dependencies.email.send(
                email_request, idempotency_key=f"{envelope.event_id}:email"
            )
            results.append(_processing_result(envelope, email_result))
        # The API currently emits a dedicated ``appointment.calendar_sync`` row
        # with interval data.  A confirmation row may still advertise the
        # calendar channel without carrying times; defer that projection rather
        # than turning the otherwise valid confirmation into a terminal failure.
        if "calendar" in channels and payload.get("starts_at") and payload.get("ends_at"):
            calendar_payload = {
                "appointment_id": str(appointment_uuid),
                "doctor_id": payload.get("doctor_id"),
                "starts_at": payload.get("starts_at"),
                "ends_at": payload.get("ends_at"),
                "time_zone": payload.get("time_zone"),
                "event_label": "Healthcare appointment",
                "action": "create",
            }
            try:
                calendar_request = CalendarRequest.model_validate(calendar_payload)
            except ValidationError:
                return ProcessingResult.terminal(
                    envelope.event_id, error_code="INVALID_EVENT_PAYLOAD"
                )
            calendar_result = dependencies.calendar.upsert_event(
                calendar_request, idempotency_key=f"{envelope.event_id}:calendar"
            )
            results.append(_processing_result(envelope, calendar_result))
        if any(result.outcome is ProcessingOutcome.RETRYABLE_FAILURE for result in results):
            retry_after = next(
                (
                    result.retry_after_seconds
                    for result in results
                    if result.retry_after_seconds is not None
                ),
                None,
            )
            return ProcessingResult.retryable(
                envelope.event_id,
                error_code="CONFIRMATION_PROJECTION_RETRYABLE",
                retry_after_seconds=retry_after,
            )
        terminal = next(
            (result for result in results if result.outcome is ProcessingOutcome.TERMINAL_FAILURE),
            None,
        )
        if terminal is not None:
            return ProcessingResult.terminal(
                envelope.event_id,
                error_code=terminal.error_code or "CONFIRMATION_PROJECTION_FAILED",
            )
        references = [result.provider_reference for result in results if result.provider_reference]
        return ProcessingResult.success(
            envelope.event_id, provider_reference=",".join(references) or None
        )

    return handle


def _medication_reminder_handler(dependencies: HandlerDependencies) -> EventHandler:
    email_handler = _email_handler(dependencies)

    def handle(envelope: EventEnvelope) -> ProcessingResult:
        dispatcher = dependencies.medication_reminders
        if dispatcher is None:
            return email_handler(envelope)
        try:
            request = MedicationReminderRequest.model_validate(envelope.safe_payload.as_dict())
        except ValidationError:
            return ProcessingResult.terminal(envelope.event_id, error_code="INVALID_EVENT_PAYLOAD")
        return _processing_result(
            envelope,
            dispatcher.dispatch(request, idempotency_key=envelope.deduplication_key),
        )

    return handle


def build_default_registry(
    dependencies: HandlerDependencies | None = None,
) -> HandlerRegistry:
    """Register every stable and API-emitted event with an explicit handler."""

    resolved = dependencies or default_handler_dependencies()
    email_handler = _email_handler(resolved)
    calendar_handler = _calendar_handler(resolved)
    llm_handler = _llm_handler(resolved)
    registry = HandlerRegistry()
    for event_type in EMAIL_EVENT_TYPES - {"medication.reminder"}:
        registry.register(event_type, email_handler)
    registry.register("medication.reminder", _medication_reminder_handler(resolved))
    for event_type in CALENDAR_EVENT_TYPES:
        registry.register(event_type, calendar_handler)
    for event_type in LLM_EVENT_TYPES:
        registry.register(event_type, llm_handler)
    registry.register("appointment.confirmed", _appointment_confirmed_handler(resolved))
    registry.register("appointment.calendar_sync", calendar_handler)
    # Keep an assertion close to the registry so API additions cannot silently
    # fall through to the unsupported-event terminal path.
    missing = API_EVENT_TYPES - registry.event_types
    if missing:
        raise RuntimeError(
            "API event contract has no worker handler: " + ", ".join(sorted(missing))
        )
    return registry
