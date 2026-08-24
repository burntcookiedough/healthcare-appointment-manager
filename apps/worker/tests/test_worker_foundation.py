from __future__ import annotations

import logging
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

import healthcare_worker.processor as processor_module
from healthcare_worker.adapters import (
    DeterministicFakeClinicalLLMAdapter,
    DeterministicFakeEmailAdapter,
    DeterministicFakeGoogleCalendarAdapter,
)
from healthcare_worker.celery_app import create_celery_app
from healthcare_worker.envelope import EventEnvelope
from healthcare_worker.events import EventType
from healthcare_worker.handlers import HandlerDependencies, build_default_registry
from healthcare_worker.idempotency import InMemoryDeduplicationStore
from healthcare_worker.logging import safe_log
from healthcare_worker.ports import AdapterResult
from healthcare_worker.processor import process_envelope
from healthcare_worker.results import ProcessingOutcome
from healthcare_worker.retry import RetryPolicy
from healthcare_worker.tasks import process_event


def make_envelope(
    event_type: str = EventType.EMAIL_NOTIFICATION.value,
    *,
    version: int = 1,
    payload: dict[str, object] | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        version=version,
        event_id=uuid4(),
        correlation_id=str(uuid4()),
        aggregate_id=uuid4(),
        event_type=event_type,
        payload=payload or {"appointment_id": str(uuid4()), "template_key": "appointment_update"},
    )


def test_known_event_routes_to_provider_port() -> None:
    email = DeterministicFakeEmailAdapter()
    dependencies = HandlerDependencies(
        email=email,
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    envelope = make_envelope()

    result = process_envelope(
        envelope,
        registry=build_default_registry(dependencies),
        deduplication=InMemoryDeduplicationStore(),
    )

    assert result.outcome is ProcessingOutcome.SUCCEEDED
    assert len(email.calls) == 1
    assert email.calls[0].idempotency_key == str(envelope.event_id)


def test_unsupported_event_type_is_terminal_and_not_called() -> None:
    email = DeterministicFakeEmailAdapter()
    dependencies = HandlerDependencies(
        email=email,
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )

    result = process_envelope(
        make_envelope("future.provider.operation"),
        registry=build_default_registry(dependencies),
        deduplication=InMemoryDeduplicationStore(),
    )

    assert result.outcome is ProcessingOutcome.TERMINAL_FAILURE
    assert result.error_code == "UNSUPPORTED_EVENT_TYPE"
    assert email.calls == []


def test_redelivery_is_idempotent_within_deduplication_boundary() -> None:
    email = DeterministicFakeEmailAdapter()
    dependencies = HandlerDependencies(
        email=email,
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    store = InMemoryDeduplicationStore()
    registry = build_default_registry(dependencies)
    envelope = make_envelope()

    first = process_envelope(envelope, registry=registry, deduplication=store)
    second = process_envelope(envelope, registry=registry, deduplication=store)

    assert first.is_success
    assert second.is_success
    assert second.deduplicated is True
    assert len(email.calls) == 1


def test_retryable_provider_failure_is_distinct_from_terminal_failure() -> None:
    retrying_email = DeterministicFakeEmailAdapter(
        [AdapterResult.retryable("EMAIL_TEMPORARY"), AdapterResult.success("email-1")]
    )
    dependencies = HandlerDependencies(
        email=retrying_email,
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    registry = build_default_registry(dependencies)
    store = InMemoryDeduplicationStore()
    envelope = make_envelope()

    first = process_envelope(envelope, registry=registry, deduplication=store)
    second = process_envelope(envelope, registry=registry, deduplication=store)

    assert first.outcome is ProcessingOutcome.RETRYABLE_FAILURE
    assert first.error_code == "EMAIL_TEMPORARY"
    assert second.outcome is ProcessingOutcome.SUCCEEDED

    terminal_email = DeterministicFakeEmailAdapter([AdapterResult.terminal("EMAIL_INVALID")])
    terminal_dependencies = HandlerDependencies(
        email=terminal_email,
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    terminal = process_envelope(
        make_envelope(),
        registry=build_default_registry(terminal_dependencies),
        deduplication=InMemoryDeduplicationStore(),
    )
    assert terminal.outcome is ProcessingOutcome.TERMINAL_FAILURE
    assert terminal.error_code == "EMAIL_INVALID"


def test_retry_policy_is_bounded_and_supports_zero_jitter() -> None:
    policy = RetryPolicy(
        max_retries=2,
        base_delay_seconds=2,
        max_delay_seconds=5,
        jitter_seconds=0,
        random_value=lambda: 0.0,
    )

    assert policy.has_retries_remaining(0)
    assert policy.has_retries_remaining(1)
    assert not policy.has_retries_remaining(2)
    assert policy.delay_for(1) == 2
    assert policy.delay_for(2) == 4
    assert policy.delay_for(3) == 5


def test_celery_retry_ceiling_returns_terminal_result(monkeypatch: pytest.MonkeyPatch) -> None:
    envelope = make_envelope()
    registry = build_default_registry(
        HandlerDependencies(
            email=DeterministicFakeEmailAdapter([AdapterResult.retryable("EMAIL_TEMPORARY")]),
            calendar=DeterministicFakeGoogleCalendarAdapter(),
            clinical_llm=DeterministicFakeClinicalLLMAdapter(),
        )
    )
    monkeypatch.setattr(processor_module, "DEFAULT_REGISTRY", registry)
    process_event.push_request(retries=5)
    try:
        result = process_event.run(envelope.model_dump(mode="json"))
    finally:
        process_event.pop_request()

    assert result["outcome"] == ProcessingOutcome.TERMINAL_FAILURE.value
    assert result["error_code"] == "RETRY_CEILING_EXCEEDED"
    assert result["attempt"] == 5


def test_celery_retry_wiring_schedules_bounded_redelivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    envelope = make_envelope()
    registry = build_default_registry(
        HandlerDependencies(
            email=DeterministicFakeEmailAdapter(
                [AdapterResult.retryable("EMAIL_TEMPORARY", retry_after_seconds=11)]
            ),
            calendar=DeterministicFakeGoogleCalendarAdapter(),
            clinical_llm=DeterministicFakeClinicalLLMAdapter(),
        )
    )
    monkeypatch.setattr(processor_module, "DEFAULT_REGISTRY", registry)
    retry_call: dict[str, object] = {}

    class RetryScheduled(Exception):
        pass

    def fake_retry(*args: object, **kwargs: object) -> None:
        retry_call.update(kwargs)
        raise RetryScheduled

    monkeypatch.setattr(process_event, "retry", fake_retry)
    process_event.push_request(retries=0)
    try:
        with pytest.raises(RetryScheduled):
            process_event.run(envelope.model_dump(mode="json"))
    finally:
        process_event.pop_request()

    assert retry_call["max_retries"] == 5
    assert retry_call["countdown"] >= 11
    assert retry_call["args"] == (envelope.model_dump(mode="json"),)


def test_invalid_envelope_is_rejected_without_echoing_payload() -> None:
    for unsafe_payload in (
        {"symptoms_text": "synthetic secret"},
        {"patient_name": "Synthetic Patient"},
        {"email_address": "synthetic@example.test"},
    ):
        with pytest.raises(ValidationError):
            EventEnvelope(
                version=1,
                event_id=uuid4(),
                correlation_id=str(uuid4()),
                aggregate_id=uuid4(),
                event_type=EventType.EMAIL_NOTIFICATION.value,
                payload=unsafe_payload,
            )

    result = process_event.run({"version": 1, "payload": {"symptoms_text": "synthetic secret"}})
    assert result["outcome"] == ProcessingOutcome.TERMINAL_FAILURE.value
    assert result["error_code"] == "INVALID_ENVELOPE"


def test_unsupported_event_version_is_terminal() -> None:
    envelope = make_envelope(version=2)
    result = process_envelope(
        envelope,
        supported_version=1,
        deduplication=InMemoryDeduplicationStore(),
    )

    assert result.outcome is ProcessingOutcome.TERMINAL_FAILURE
    assert result.error_code == "UNSUPPORTED_EVENT_VERSION"


def test_celery_app_import_and_smoke_do_not_require_redis() -> None:
    app = create_celery_app()

    assert app.conf.broker_url.startswith("redis://")
    assert app.conf.task_serializer == "json"
    assert app.conf.accept_content == ["json"]


def test_safe_logging_drops_clinical_fields(caplog: pytest.LogCaptureFixture) -> None:
    logger = logging.getLogger("healthcare_worker.test")
    with caplog.at_level(logging.INFO, logger=logger.name):
        safe_log(
            logger,
            logging.INFO,
            "event_processed",
            fields={
                "event_id": str(uuid4()),
                "symptoms_text": "synthetic clinical secret",
                "notes": "synthetic note",
            },
        )

    assert "synthetic clinical secret" not in caplog.text
    assert "synthetic note" not in caplog.text
    assert "symptoms_text" not in caplog.text


def test_processing_result_event_id_is_uuid() -> None:
    result = process_envelope(make_envelope(), deduplication=InMemoryDeduplicationStore())

    assert isinstance(result.event_id, UUID)
