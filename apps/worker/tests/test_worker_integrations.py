from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from healthcare_worker.adapters import (
    DeterministicFakeClinicalLLMAdapter,
    DeterministicFakeEmailAdapter,
    DeterministicFakeGoogleCalendarAdapter,
    GoogleCalendarOAuthAdapter,
    HttpClinicalLLMAdapter,
    HttpResponse,
    InMemoryTrustedDataResolver,
    SendGridEmailAdapter,
)
from healthcare_worker.envelope import EventEnvelope
from healthcare_worker.events import (
    API_EVENT_TYPES,
    EventType,
    assert_supported_api_events,
    translated_event_types,
)
from healthcare_worker.handlers import HandlerDependencies, build_default_registry
from healthcare_worker.llm import (
    GeneratedSummaryRecord,
    InMemorySummaryRepository,
    PostgresSummaryRepository,
    PreVisitOutput,
    PromptMetadata,
    output_schema_for_task,
)
from healthcare_worker.outbox import (
    InMemoryOutboxStore,
    OutboxPoller,
    OutboxRecord,
    PostgresOutboxStore,
)
from healthcare_worker.ports import (
    CalendarRequest,
    ClinicalSummaryRequest,
    EmailContent,
    EmailRequest,
    OAuthCredentials,
    SummarySource,
    TrustedDataResolutionError,
)
from healthcare_worker.processor import process_envelope, process_envelope_async
from healthcare_worker.reminders import (
    InMemoryReminderOccurrenceStore,
    MedicationReminderDispatcher,
    MedicationReminderRequest,
    PostgresReminderOccurrenceStore,
    PrescriptionSchedule,
    generate_medication_occurrences,
)
from healthcare_worker.resolver import PostgresTrustedDataResolver
from healthcare_worker.results import ProcessingOutcome, ProcessingResult
from healthcare_worker.retry import RetryPolicy


def envelope(event_type: str, payload: dict[str, Any]) -> EventEnvelope:
    return EventEnvelope(
        version=1,
        event_id=uuid4(),
        correlation_id=str(uuid4()),
        aggregate_id=uuid4(),
        event_type=event_type,
        payload=payload,
    )


def test_api_event_contract_is_explicit_and_translated() -> None:
    registry = build_default_registry()
    assert registry.event_types >= API_EVENT_TYPES
    assert translated_event_types(EventType.APPOINTMENT_CONFIRMED.value) == frozenset(
        {EventType.EMAIL_NOTIFICATION.value, EventType.CALENDAR_SYNC.value}
    )
    assert translated_event_types(EventType.APPOINTMENT_CALENDAR_SYNC.value) == frozenset(
        {EventType.CALENDAR_SYNC.value}
    )
    assert_supported_api_events(API_EVENT_TYPES)


def test_appointment_confirmed_dispatches_email_and_calendar_projections() -> None:
    email = DeterministicFakeEmailAdapter()
    calendar = DeterministicFakeGoogleCalendarAdapter()
    dependencies = HandlerDependencies(
        email=email,
        calendar=calendar,
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    item = envelope(
        EventType.APPOINTMENT_CONFIRMED.value,
        {
            "appointment_id": str(uuid4()),
            "channels": ["email", "calendar"],
            "starts_at": "2026-08-24T10:00:00Z",
            "ends_at": "2026-08-24T11:00:00Z",
        },
    )
    result = process_envelope(
        item,
        registry=build_default_registry(dependencies),
        deduplication=None,
    )
    assert result.is_success
    assert [call.idempotency_key for call in email.calls] == [f"{item.event_id}:email"]
    assert [call.idempotency_key for call in calendar.calls] == [f"{item.event_id}:calendar"]


@pytest.mark.parametrize(
    "payload",
    [
        {"appointment_id": "synthetic-ref", "action": "delete"},
        '{"appointment_id":"synthetic-ref","action":"delete"}',
        b'{"appointment_id":"synthetic-ref","action":"delete"}',
    ],
)
def test_outbox_record_decodes_mapping_text_and_safe_bytes(payload: object) -> None:
    event_id = uuid4()
    record = OutboxRecord.from_mapping(
        {
            "id": event_id,
            "event_type": EventType.CALENDAR_SYNC.value,
            "aggregate_type": "appointment",
            "aggregate_id": uuid4(),
            "dedupe_key": "calendar:decode",
            "payload": payload,
        }
    )
    assert record.payload["action"] == "delete"


def test_outbox_record_rejects_invalid_json_without_payload_echo() -> None:
    with pytest.raises(ValueError, match="outbox payload"):
        OutboxRecord.from_mapping(
            {
                "id": uuid4(),
                "event_type": EventType.CALENDAR_SYNC.value,
                "aggregate_id": uuid4(),
                "payload": b"not-json synthetic clinical text",
            }
        )


def test_legacy_calendar_cancellation_is_delete_and_never_create() -> None:
    calendar = DeterministicFakeGoogleCalendarAdapter()
    appointment_id = uuid4()
    dependencies = HandlerDependencies(
        email=DeterministicFakeEmailAdapter(),
        calendar=calendar,
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
    )
    result = process_envelope(
        envelope(
            EventType.CALENDAR_SYNC.value,
            {
                "appointment_id": str(appointment_id),
                "event_label": "Healthcare appointment cancellation",
            },
        ),
        registry=build_default_registry(dependencies),
        deduplication=None,
    )
    assert result.is_success
    assert len(calendar.calls) == 1
    assert isinstance(calendar.calls[0].request, CalendarRequest)
    assert calendar.calls[0].request.action == "delete"


def test_calendar_delete_resolves_trusted_provider_reference() -> None:
    appointment_id = uuid4()
    resolver = InMemoryTrustedDataResolver(
        calendar_credentials={"default": OAuthCredentials(access_token="synthetic-token")},
        calendar_event_references={str(appointment_id): "trusted-event-1"},
    )
    transport = FakeTransport(HttpResponse(204, {}))
    adapter = GoogleCalendarOAuthAdapter(
        client_id="client",
        client_secret="secret",
        resolver=resolver,
        transport=transport,
    )
    result = adapter.upsert_event(
        CalendarRequest(appointment_id=appointment_id, action="delete"),
        idempotency_key="event:calendar",
    )
    assert result.is_success
    assert transport.requests[0][0] == "DELETE"
    assert transport.requests[0][1].endswith("/trusted-event-1")


@pytest.mark.parametrize("status_code", [404, 410])
def test_calendar_delete_is_idempotent_when_provider_event_is_absent(status_code: int) -> None:
    appointment_id = uuid4()
    resolver = InMemoryTrustedDataResolver(
        calendar_credentials={"default": OAuthCredentials(access_token="synthetic-token")},
        calendar_event_references={str(appointment_id): "trusted-event-1"},
    )
    transport = FakeTransport(HttpResponse(status_code, {}))
    adapter = GoogleCalendarOAuthAdapter(
        client_id="client",
        client_secret="secret",
        resolver=resolver,
        transport=transport,
    )

    result = adapter.upsert_event(
        CalendarRequest(appointment_id=appointment_id, action="delete"),
        idempotency_key="event:calendar:delete-replay",
    )

    assert result.is_success
    assert result.provider_reference == "trusted-event-1"


def test_calendar_create_always_returns_deterministic_idempotency_reference() -> None:
    resolver = InMemoryTrustedDataResolver(
        calendar_credentials={"default": OAuthCredentials(access_token="synthetic-token")}
    )
    transport = FakeTransport(HttpResponse(200, {}, b'{"id":"provider-response-id"}'))
    adapter = GoogleCalendarOAuthAdapter(
        client_id="client",
        client_secret="secret",
        resolver=resolver,
        transport=transport,
    )
    request = CalendarRequest(
        appointment_id=uuid4(),
        starts_at=datetime(2026, 8, 24, 10, tzinfo=UTC),
        ends_at=datetime(2026, 8, 24, 11, tzinfo=UTC),
        provider_event_reference="stale-payload-reference",
        action="create",
    )

    result = adapter.upsert_event(request, idempotency_key="event:calendar:create")

    expected = hashlib.sha256(b"event:calendar:create").hexdigest()[:32]
    assert result.is_success
    assert result.provider_reference == expected
    body = json.loads(transport.requests[0][3])
    assert body["id"] == expected


def test_canonical_and_legacy_llm_task_kinds_are_explicit() -> None:
    for task_kind in ("pre_visit", "post_visit", "plain_language_summary"):
        assert ClinicalSummaryRequest(task_kind=task_kind).task_kind == task_kind
    assert (
        ClinicalSummaryRequest.model_validate({"task_kind": "pre_visit_brief"}).task_kind
        == "pre_visit"
    )
    assert (
        ClinicalSummaryRequest.model_validate({"task_kind": "post_visit_summary"}).task_kind
        == "post_visit"
    )
    with pytest.raises(ValidationError):
        ClinicalSummaryRequest.model_validate({"task_kind": "unsupported_summary"})


def test_invalid_llm_task_kind_is_terminal_without_payload_logging(
    caplog: pytest.LogCaptureFixture,
) -> None:
    source_id = uuid4()
    with caplog.at_level("INFO"):
        result = process_envelope(
            envelope(
                EventType.CLINICAL_LLM_SUMMARY.value,
                {
                    "source_record_reference": str(source_id),
                    "source_version": 1,
                    "task_kind": "unsupported_summary",
                },
            ),
            registry=build_default_registry(),
            deduplication=None,
        )
    assert result.outcome is ProcessingOutcome.TERMINAL_FAILURE
    assert result.error_code == "INVALID_EVENT_PAYLOAD"
    assert "unsupported_summary" not in caplog.text


def test_postgres_claim_rolls_back_when_jsonb_conversion_fails() -> None:
    class FakeTransaction:
        def __init__(self) -> None:
            self.exception_type: type[BaseException] | None = None

        async def __aenter__(self) -> FakeTransaction:
            return self

        async def __aexit__(
            self,
            exception_type: type[BaseException] | None,
            _exception: BaseException | None,
            _traceback: object,
        ) -> bool:
            self.exception_type = exception_type
            return False

    class FakeConnection:
        def __init__(self) -> None:
            self.transaction_context = FakeTransaction()

        def transaction(self) -> FakeTransaction:
            return self.transaction_context

        async def fetch(self, *_args: object) -> list[dict[str, object]]:
            return [
                {
                    "id": uuid4(),
                    "event_type": EventType.EMAIL_NOTIFICATION.value,
                    "aggregate_type": "appointment",
                    "aggregate_id": uuid4(),
                    "dedupe_key": "decode-failure",
                    "payload": b"{malformed",
                }
            ]

    class FakeAcquire:
        def __init__(self, connection: FakeConnection) -> None:
            self.connection = connection

        async def __aenter__(self) -> FakeConnection:
            return self.connection

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class FakePool:
        def __init__(self) -> None:
            self.connection = FakeConnection()

        def acquire(self) -> FakeAcquire:
            return FakeAcquire(self.connection)

    pool = FakePool()

    async def scenario() -> None:
        with pytest.raises(ValueError, match="outbox payload"):
            await PostgresOutboxStore(pool).claim_batch(limit=1, lease_seconds=10)

    asyncio.run(scenario())
    assert pool.connection.transaction_context.exception_type is ValueError


def test_postgres_claim_marks_recovered_processing_rows() -> None:
    class Transaction:
        async def __aenter__(self) -> Transaction:
            return self

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class Connection:
        def transaction(self) -> Transaction:
            return Transaction()

        async def fetch(self, *_args: object) -> list[dict[str, object]]:
            return [
                {
                    "id": uuid4(),
                    "event_type": EventType.EMAIL_NOTIFICATION.value,
                    "aggregate_type": "appointment",
                    "aggregate_id": uuid4(),
                    "dedupe_key": "recovered:1",
                    "payload": {},
                    "status": "processing",
                    "previous_status": "processing",
                    "attempt_count": 3,
                    "next_attempt_at": datetime.now(UTC),
                }
            ]

    class Acquire:
        async def __aenter__(self) -> Connection:
            return Connection()

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class Pool:
        def acquire(self) -> Acquire:
            return Acquire()

    claimed = asyncio.run(PostgresOutboxStore(Pool()).claim_batch(limit=1, lease_seconds=10))
    assert len(claimed) == 1
    assert claimed[0].record.recovered is True


def test_outbox_poller_persists_retry_then_success_and_recovers_leases() -> None:
    event_id = uuid4()
    aggregate_id = uuid4()
    record = OutboxRecord(
        event_id=event_id,
        event_type=EventType.EMAIL_NOTIFICATION.value,
        aggregate_type="appointment",
        aggregate_id=aggregate_id,
        dedupe_key="notification:1",
        payload={"template_key": "appointment_update"},
    )
    store = InMemoryOutboxStore([record])
    outcomes = iter(
        [
            ProcessingResult.retryable(event_id, error_code="EMAIL_TEMPORARY"),
            ProcessingResult.success(event_id, provider_reference="provider-1"),
        ]
    )
    poller = OutboxPoller(
        store,
        lambda _: next(outcomes),
        max_concurrency=2,
        batch_size=2,
        retry_policy=RetryPolicy(max_retries=2, base_delay_seconds=0.01, jitter_seconds=0),
    )
    first = asyncio.run(poller.poll_once())
    assert first[0].outcome is ProcessingOutcome.RETRYABLE_FAILURE
    assert store.records[event_id].attempt_count == 1
    store.records[event_id] = replace(store.records[event_id], next_attempt_at=datetime.now(UTC))
    second = asyncio.run(poller.poll_once())
    assert second[0].is_success
    assert store.records[event_id].status == "succeeded"
    assert store.records[event_id].attempt_count == 2

    recovered_id = uuid4()
    recovered = OutboxRecord(
        event_id=recovered_id,
        event_type=EventType.EMAIL_NOTIFICATION.value,
        aggregate_type="appointment",
        aggregate_id=uuid4(),
        dedupe_key="notification:recovered",
        payload={"template_key": "appointment_update"},
        status="processing",
        attempt_count=1,
        next_attempt_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    recovery_store = InMemoryOutboxStore([recovered])
    recovery_poller = OutboxPoller(
        recovery_store,
        lambda _: ProcessingResult.success(recovered_id),
        max_concurrency=1,
        batch_size=1,
    )
    asyncio.run(recovery_poller.poll_once())
    assert recovery_poller.metrics.recovered == 1
    assert recovery_store.records[recovered_id].attempt_count == 2
    assert (
        asyncio.run(recovery_store.mark_succeeded(recovered_id, attempt=1, provider_reference=None))
        is False
    )


class FakeTransport:
    def __init__(self, *responses: HttpResponse) -> None:
        self.responses = list(responses)
        self.requests: list[tuple[str, str, dict[str, str], bytes]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes = b"",
        timeout_seconds: float,
    ) -> HttpResponse:
        del timeout_seconds
        self.requests.append((method, url, dict(headers), body))
        return self.responses.pop(0)


class ResolverConnection:
    """Small asyncpg-shaped fixture that returns only synthetic trusted rows."""

    def __init__(self, *, patient_exists: bool = False) -> None:
        self.patient_exists = patient_exists
        self.calendar_event_id = uuid4()
        self.queries: list[str] = []

    async def fetchrow(self, statement: str, *_parameters: object) -> dict[str, object] | None:
        self.queries.append(statement)
        if "patient_profiles" in statement:
            return {"exists": 1} if self.patient_exists else None
        if "integration_operations" in statement:
            return {
                "provider_reference": "trusted-calendar-event",
                "outbox_event_id": self.calendar_event_id,
                "payload_provider_reference": None,
            }
        if "symptom_versions" in statement:
            return {"symptoms_text": "Synthetic symptom source"}
        if "visits" in statement:
            return {"notes_text": "Synthetic clinician note"}
        return None

    async def fetch(self, statement: str, *_parameters: object) -> list[dict[str, object]]:
        self.queries.append(statement)
        if "prescription_items" in statement:
            return []
        return []


class ResolverAcquire:
    def __init__(self, connection: ResolverConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> ResolverConnection:
        return self.connection

    async def __aexit__(self, *_args: object) -> bool:
        return False


class ResolverPool:
    def __init__(self, connection: ResolverConnection) -> None:
        self.connection = connection

    def acquire(self) -> ResolverAcquire:
        return ResolverAcquire(self.connection)


def test_postgres_resolver_binds_summary_and_calendar_references_without_contact_or_tokens() -> (
    None
):
    source_id = uuid4()
    appointment_id = uuid4()
    patient_id = uuid4()
    connection = ResolverConnection(patient_exists=True)
    resolver = PostgresTrustedDataResolver(ResolverPool(connection))

    async def scenario() -> None:
        async with resolver.bind(
            envelope(
                EventType.CLINICAL_LLM_SUMMARY.value,
                {
                    "source_record_reference": str(source_id),
                    "source_version": 1,
                    "task_kind": "pre_visit",
                },
            )
        ):
            source = resolver.resolve_summary_source(
                ClinicalSummaryRequest(
                    source_record_reference=source_id,
                    source_version=1,
                    task_kind="pre_visit",
                )
            )
            assert source is not None
            assert source.source_text == "Synthetic symptom source"

        async with resolver.bind(
            envelope(
                EventType.CALENDAR_SYNC.value,
                {
                    "appointment_id": str(appointment_id),
                    "action": "delete",
                },
            )
        ):
            event_reference = resolver.resolve_calendar_event_reference(
                CalendarRequest(appointment_id=appointment_id, action="delete")
            )
            assert event_reference == "trusted-calendar-event"

        async with resolver.bind(
            envelope(
                EventType.EMAIL_NOTIFICATION.value,
                {
                    "appointment_id": str(appointment_id),
                    "recipient_reference": str(patient_id),
                },
            )
        ):
            result = SendGridEmailAdapter(
                api_key="synthetic-key",
                from_email="worker@example.test",
                resolver=resolver,
                transport=FakeTransport(HttpResponse(202, {})),
            ).send(
                EmailRequest(recipient_reference=str(patient_id)),
                idempotency_key="event:email",
            )
            assert result.error_code == "EMAIL_RECIPIENT_UNAVAILABLE"

        with pytest.raises(TrustedDataResolutionError) as credentials_error:
            resolver.resolve_calendar_credentials(
                CalendarRequest(appointment_id=appointment_id, action="create")
            )
        assert credentials_error.value.code == "CALENDAR_CREDENTIALS_UNAVAILABLE"

    asyncio.run(scenario())
    assert any("symptom_versions" in query for query in connection.queries)
    assert any("integration_operations" in query for query in connection.queries)


def test_postgres_resolver_preserves_all_prescription_items() -> None:
    prescription_id = uuid4()
    first_item_id = uuid4()
    second_item_id = uuid4()
    rows = [
        {
            "prescription_id": prescription_id,
            "prescription_version": 3,
            "item_id": first_item_id,
            "medication_name": "First synthetic medication",
            "dosage": "5 mg",
            "route": "oral",
            "frequency": "once_daily",
            "start_date": date(2026, 8, 24),
            "end_date": date(2026, 8, 24),
            "duration_days": 1,
            "instructions": "Take with water",
            "time_zone": "UTC",
        },
        {
            "prescription_id": prescription_id,
            "prescription_version": 3,
            "item_id": second_item_id,
            "medication_name": "Second synthetic medication",
            "dosage": "10 mg",
            "route": "oral",
            "frequency": "twice_daily",
            "start_date": date(2026, 8, 24),
            "end_date": date(2026, 8, 24),
            "duration_days": 1,
            "instructions": "Take after food",
            "time_zone": "UTC",
        },
    ]

    class Connection:
        async def fetchrow(self, _statement: str, *_parameters: object) -> None:
            return None

        async def fetch(self, statement: str, *_parameters: object) -> list[dict[str, object]]:
            return rows if "prescription_items" in statement else []

    class Acquire:
        async def __aenter__(self) -> Connection:
            return Connection()

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class Pool:
        def acquire(self) -> Acquire:
            return Acquire()

    resolver = PostgresTrustedDataResolver(Pool())
    request = envelope(
        EventType.MEDICATION_REMINDER.value,
        {
            "prescription_id": str(prescription_id),
            "prescription_version": 3,
            "occurrence_id": str(uuid4()),
        },
    )

    async def scenario() -> tuple[object, ...]:
        async with resolver.bind(request):
            raw = resolver.resolve_prescription_schedule(prescription_id, 3)
            assert isinstance(raw, tuple)
            return raw

    schedules = asyncio.run(scenario())

    assert len(schedules) == 2
    assert {item["prescription_item_id"] for item in schedules if isinstance(item, dict)} == {
        first_item_id,
        second_item_id,
    }


@pytest.mark.parametrize("failure", ["source_shape", "driver"])
def test_postgres_resolver_classifies_source_shape_and_driver_failures(
    failure: str,
) -> None:
    prescription_id = uuid4()

    class Connection:
        async def fetchrow(self, _statement: str, *_parameters: object) -> None:
            return None

        async def fetch(self, statement: str, *_parameters: object) -> list[dict[str, object]]:
            if "prescription_items" not in statement:
                return []
            if failure == "driver":
                raise RuntimeError("synthetic database driver failure")
            return [{"prescription_id": "not-a-uuid", "item_id": uuid4()}]

    class Acquire:
        async def __aenter__(self) -> Connection:
            return Connection()

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class Pool:
        def acquire(self) -> Acquire:
            return Acquire()

    resolver = PostgresTrustedDataResolver(Pool())
    request = envelope(
        EventType.MEDICATION_REMINDER.value,
        {
            "prescription_id": str(prescription_id),
            "prescription_version": 1,
            "occurrence_id": str(uuid4()),
        },
    )

    async def scenario() -> tuple[TrustedDataResolutionError, ProcessingResult]:
        async with resolver.bind(request):
            with pytest.raises(TrustedDataResolutionError) as error:
                resolver.resolve_prescription_schedule(prescription_id, 1)
            dispatcher = MedicationReminderDispatcher(
                resolver=resolver,
                email=DeterministicFakeEmailAdapter(),
                occurrence_store=InMemoryReminderOccurrenceStore(),
            )
            result = dispatcher.dispatch(
                MedicationReminderRequest(
                    prescription_id=prescription_id,
                    prescription_version=1,
                    occurrence_id=uuid4(),
                ),
                idempotency_key="event:resolver-classification",
            )
            return error.value, result

    error, result = asyncio.run(scenario())

    assert error.code == "PRESCRIPTION_REFERENCE_ERROR"
    assert error.retryable is (failure == "driver")
    assert result.error_code == "PRESCRIPTION_REFERENCE_ERROR"
    assert result.is_retryable is (failure == "driver")


def test_sendgrid_calendar_adapters_are_mockable_and_fail_closed() -> None:
    resolver = InMemoryTrustedDataResolver(
        email={
            "patient-ref": EmailContent(
                recipient_email="synthetic@example.test",
                subject="Appointment update",
                text_body="Synthetic notification",
            )
        },
        calendar_credentials={"default": OAuthCredentials(access_token="synthetic-token")},
    )
    email_transport = FakeTransport(HttpResponse(202, {}))
    email_adapter = SendGridEmailAdapter(
        api_key="synthetic-key",
        from_email="worker@example.test",
        resolver=resolver,
        transport=email_transport,
    )
    email_result = email_adapter.send(
        EmailRequest(template_key="appointment_update", recipient_reference="patient-ref"),
        idempotency_key=str(uuid4()),
    )
    assert email_result.is_success
    assert b"synthetic@example.test" in email_transport.requests[0][3]
    assert (
        SendGridEmailAdapter(api_key=None, from_email=None, resolver=None)
        .send(
            EmailRequest(template_key="appointment_update"),
            idempotency_key="event",
        )
        .error_code
        == "PROVIDER_NOT_CONFIGURED"
    )

    calendar_transport = FakeTransport(
        HttpResponse(200, {}, b'{"id":"google-event-1"}'),
        HttpResponse(200, {}, b'{"id":"google-event-1"}'),
        HttpResponse(204, {}),
    )
    calendar_adapter = GoogleCalendarOAuthAdapter(
        client_id="client",
        client_secret="secret",
        resolver=resolver,
        transport=calendar_transport,
    )
    request = CalendarRequest(
        appointment_id=uuid4(),
        starts_at=datetime(2026, 8, 24, 10, tzinfo=UTC),
        ends_at=datetime(2026, 8, 24, 11, tzinfo=UTC),
        action="create",
    )
    assert calendar_adapter.upsert_event(request, idempotency_key="event:calendar").is_success
    updated = request.model_copy(
        update={"action": "update", "provider_event_reference": "google-event-1"}
    )
    assert calendar_adapter.upsert_event(updated, idempotency_key="event:calendar").is_success
    deleted = updated.model_copy(update={"action": "delete"})
    assert calendar_adapter.upsert_event(deleted, idempotency_key="event:calendar").is_success
    assert [request[0] for request in calendar_transport.requests] == ["POST", "PATCH", "DELETE"]

    no_body_transport = FakeTransport(HttpResponse(204, {}))
    no_body_adapter = GoogleCalendarOAuthAdapter(
        client_id="client",
        client_secret="secret",
        resolver=resolver,
        transport=no_body_transport,
    )
    no_body_result = no_body_adapter.upsert_event(
        CalendarRequest(
            appointment_id=uuid4(),
            starts_at=datetime(2026, 8, 24, 10, tzinfo=UTC),
            ends_at=datetime(2026, 8, 24, 11, tzinfo=UTC),
            action="create",
        ),
        idempotency_key="event:calendar:empty-body",
    )
    assert (
        no_body_result.provider_reference
        == hashlib.sha256(b"event:calendar:empty-body").hexdigest()[:32]
    )


def test_llm_structured_output_and_handler_persistence() -> None:
    source_id = uuid4()
    resolver = InMemoryTrustedDataResolver(
        summaries={
            str(source_id): SummarySource(
                source_reference=source_id,
                source_version=3,
                source_text="Synthetic source text",
            )
        }
    )
    response = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "urgency": "Medium",
                            "chief_complaint": "Synthetic concern",
                            "suggested_questions": ["One?", "Two?", "Three?"],
                        }
                    )
                }
            }
        ]
    }
    transport = FakeTransport(
        HttpResponse(200, {}, json.dumps(response).encode()),
        HttpResponse(200, {}, json.dumps(response).encode()),
    )
    adapter = HttpClinicalLLMAdapter(
        endpoint="https://llm.example.test/v1/chat/completions",
        api_key="synthetic-key",
        provider="openai",
        model="synthetic-model",
        resolver=resolver,
        transport=transport,
    )
    request = ClinicalSummaryRequest(
        source_record_reference=source_id,
        source_version=3,
        task_kind="pre_visit",
    )
    result = adapter.generate_summary(request, idempotency_key="event:llm")
    assert result.is_success
    assert result.output and result.output["urgency"] == "Medium"

    repo = InMemorySummaryRepository()
    dependencies = HandlerDependencies(
        email=SendGridEmailAdapter(api_key=None, from_email=None, resolver=None),
        calendar=GoogleCalendarOAuthAdapter(client_id=None, client_secret=None, resolver=None),
        clinical_llm=adapter,
        summary_repository=repo,
    )
    processed = process_envelope(
        envelope(EventType.CLINICAL_LLM_SUMMARY.value, request.model_dump(mode="json")),
        registry=build_default_registry(dependencies),
    )
    assert processed.is_success
    assert len(repo.records) == 1
    assert repo.records[0].metadata.prompt_version == "clinical.v1"

    invalid_transport = FakeTransport(
        HttpResponse(200, {}, b'{"choices":[{"message":{"content":"{}"}}]}')
    )
    invalid_adapter = HttpClinicalLLMAdapter(
        endpoint="https://llm.example.test/v1/chat/completions",
        api_key="synthetic-key",
        provider="openai",
        model="synthetic-model",
        resolver=resolver,
        transport=invalid_transport,
    )
    assert (
        invalid_adapter.generate_summary(request, idempotency_key="event:llm").error_code
        == "LLM_INVALID_OUTPUT"
    )


def test_openai_strict_schema_requires_every_declared_property() -> None:
    schema = output_schema_for_task("post_visit")
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])
    assert set(schema["properties"]["next_steps"]) >= {"type"}
    assert set(schema["properties"]["warning_signs"]) >= {"type"}


def test_async_summary_repository_is_awaited_before_success() -> None:
    source_id = uuid4()
    adapter = DeterministicFakeClinicalLLMAdapter()

    class AsyncRepository:
        def __init__(self) -> None:
            self.records: list[GeneratedSummaryRecord] = []

        async def persist_summary(self, record: GeneratedSummaryRecord) -> None:
            self.records.append(record)

    repository = AsyncRepository()
    dependencies = HandlerDependencies(
        email=DeterministicFakeEmailAdapter(),
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=adapter,
        summary_repository=repository,
    )
    request = ClinicalSummaryRequest(
        source_record_reference=source_id,
        source_version=1,
        task_kind="pre_visit",
    )
    result = asyncio.run(
        process_envelope_async(
            envelope(EventType.CLINICAL_LLM_SUMMARY.value, request.model_dump(mode="json")),
            registry=build_default_registry(dependencies),
        )
    )
    assert result.is_success
    assert len(repository.records) == 1


def test_sync_processor_does_not_create_async_summary_persistence_coroutine() -> None:
    source_id = uuid4()
    repository = type("Repository", (), {})()
    repository.persist_summary = AsyncMock()
    dependencies = HandlerDependencies(
        email=DeterministicFakeEmailAdapter(),
        calendar=DeterministicFakeGoogleCalendarAdapter(),
        clinical_llm=DeterministicFakeClinicalLLMAdapter(),
        summary_repository=repository,
    )
    request = ClinicalSummaryRequest(
        source_record_reference=source_id,
        source_version=1,
        task_kind="pre_visit",
    )

    result = process_envelope(
        envelope(EventType.CLINICAL_LLM_SUMMARY.value, request.model_dump(mode="json")),
        registry=build_default_registry(dependencies),
    )

    assert result.error_code == "ASYNC_HANDLER_REQUIRED"
    repository.persist_summary.assert_not_called()


def test_postgres_summary_repository_updates_pending_artifact_durably() -> None:
    class FakeTransaction:
        async def __aenter__(self) -> FakeTransaction:
            return self

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class FakeConnection:
        def __init__(self) -> None:
            self.statement = ""
            self.parameters: tuple[object, ...] = ()

        def transaction(self) -> FakeTransaction:
            return FakeTransaction()

        async def execute(self, statement: str, *parameters: object) -> str:
            self.statement = statement
            self.parameters = parameters
            return "UPDATE 1"

    class FakeAcquire:
        def __init__(self, connection: FakeConnection) -> None:
            self.connection = connection

        async def __aenter__(self) -> FakeConnection:
            return self.connection

        async def __aexit__(self, *_args: object) -> bool:
            return False

    class FakePool:
        def __init__(self) -> None:
            self.connection = FakeConnection()

        def acquire(self) -> FakeAcquire:
            return FakeAcquire(self.connection)

    source_id = uuid4()
    record = GeneratedSummaryRecord(
        source_record_reference=source_id,
        source_version=1,
        task_kind="pre_visit",
        metadata=PromptMetadata(
            task_kind="pre_visit",
            prompt_version="pre_visit_summary.v1",
            schema_version="clinical_summary.v1",
            provider="synthetic",
            model="synthetic-model",
        ),
        output=PreVisitOutput(
            urgency="Low",
            chief_complaint="Synthetic concern",
            suggested_questions=["One?", "Two?", "Three?"],
        ),
    )
    pool = FakePool()

    asyncio.run(PostgresSummaryRepository(pool).persist_summary(record))

    assert "UPDATE generated_artifacts" in pool.connection.statement
    assert pool.connection.parameters[0] == source_id
    assert "Synthetic concern" in str(pool.connection.parameters[3])


def test_medication_reminders_are_timezone_aware_and_restart_safe() -> None:
    prescription_id = uuid4()
    schedule = PrescriptionSchedule(
        prescription_id=prescription_id,
        prescription_version=4,
        medication_reference="medication-ref",
        start_date=date(2026, 8, 24),
        duration_days=2,
        frequency="structured",
        times_of_day=[time(8, 30), time(20, 30)],
        time_zone="Asia/Kolkata",
    )
    occurrences = generate_medication_occurrences(schedule)
    assert len(occurrences) == 4
    assert occurrences[0].due_at.tzinfo is not None
    assert occurrences[0].due_at.hour == 3
    assert occurrences[0].due_at.minute == 0
    assert [item.occurrence_id for item in occurrences] == [
        item.occurrence_id for item in generate_medication_occurrences(schedule)
    ]

    from healthcare_worker.adapters import DeterministicFakeEmailAdapter

    email = DeterministicFakeEmailAdapter()
    superseded = schedule.model_copy(update={"prescription_version": 5})
    resolver = InMemoryTrustedDataResolver(
        prescriptions={
            f"{prescription_id}:4": schedule,
            f"{prescription_id}:5": superseded,
        },
    )
    occurrence_store = InMemoryReminderOccurrenceStore()
    dispatcher = MedicationReminderDispatcher(
        resolver=resolver,
        email=email,
        occurrence_store=occurrence_store,
    )
    dispatcher.reconcile(schedule)
    new_occurrences = dispatcher.reconcile(superseded)
    assert occurrences[0].occurrence_id in occurrence_store.cancelled
    request = MedicationReminderRequest(
        prescription_id=prescription_id,
        prescription_version=5,
        occurrence_id=new_occurrences[0].occurrence_id,
        recipient_reference="patient-ref",
    )
    assert dispatcher.dispatch(request, idempotency_key="event:occurrence").is_success
    assert dispatcher.dispatch(request, idempotency_key="event:occurrence").is_success
    assert len(email.calls) == 1


def test_medication_dispatch_supports_all_items_with_stable_item_identity() -> None:
    prescription_id = uuid4()
    first_item_id = uuid4()
    second_item_id = uuid4()

    def schedule(item_id: Any, medication: str) -> PrescriptionSchedule:
        return PrescriptionSchedule(
            prescription_id=prescription_id,
            prescription_version=7,
            prescription_item_id=item_id,
            medication_reference=str(item_id),
            medication_name=medication,
            start_date=date(2026, 8, 24),
            duration_days=1,
            frequency="once_daily",
            time_zone="UTC",
        )

    first = schedule(first_item_id, "First synthetic medication")
    second = schedule(second_item_id, "Second synthetic medication")
    resolver = InMemoryTrustedDataResolver(prescriptions={f"{prescription_id}:7": [first, second]})
    email = DeterministicFakeEmailAdapter()
    dispatcher = MedicationReminderDispatcher(
        resolver=resolver,
        email=email,
        occurrence_store=InMemoryReminderOccurrenceStore(),
    )
    first_occurrence = generate_medication_occurrences(first)[0]
    second_occurrence = generate_medication_occurrences(second)[0]

    first_result = dispatcher.dispatch(
        MedicationReminderRequest(
            prescription_id=prescription_id,
            prescription_version=7,
            prescription_item_id=first_item_id,
            occurrence_id=first_occurrence.occurrence_id,
        ),
        idempotency_key="event:medication:first",
    )
    second_result = dispatcher.dispatch(
        MedicationReminderRequest(
            prescription_id=prescription_id,
            prescription_version=7,
            prescription_item_id=second_item_id,
            occurrence_id=second_occurrence.occurrence_id,
        ),
        idempotency_key="event:medication:second",
    )

    assert first_result.is_success
    assert second_result.is_success
    assert first_occurrence.occurrence_id != second_occurrence.occurrence_id
    assert len(email.calls) == 2


def test_medication_dispatch_normalizes_missing_item_identity_upsert_error() -> None:
    prescription_id = uuid4()
    schedule = PrescriptionSchedule(
        prescription_id=prescription_id,
        prescription_version=1,
        medication_reference="legacy-medication-reference",
        start_date=date(2026, 8, 24),
        duration_days=1,
        frequency="once_daily",
        time_zone="UTC",
    )
    occurrence = generate_medication_occurrences(schedule)[0]

    class Executor:
        def execute(self, _statement: str, *_parameters: object) -> int:
            raise ValueError("prescription item identity is required")

        def fetch_value(self, _statement: str, *_parameters: object) -> bool:
            return False

    resolver = InMemoryTrustedDataResolver(prescriptions={f"{prescription_id}:1": schedule})
    dispatcher = MedicationReminderDispatcher(
        resolver=resolver,
        email=DeterministicFakeEmailAdapter(),
        occurrence_store=PostgresReminderOccurrenceStore(Executor()),
    )

    result = dispatcher.dispatch(
        MedicationReminderRequest(
            prescription_id=prescription_id,
            prescription_version=1,
            occurrence_id=occurrence.occurrence_id,
        ),
        idempotency_key="event:medication:missing-item",
    )

    assert result.outcome is ProcessingOutcome.TERMINAL_FAILURE
    assert result.error_code == "INVALID_REMINDER_SCHEDULE"


def test_postgres_reminder_cancellation_is_the_dispatch_fence() -> None:
    class Executor:
        def __init__(self) -> None:
            self.executed: list[tuple[str, tuple[object, ...]]] = []
            self.cancelled = True

        def execute(self, statement: str, *parameters: object) -> int:
            self.executed.append((statement, parameters))
            return 1

        def fetch_value(self, statement: str, *_parameters: object) -> bool:
            if "status = 'cancelled'" in statement:
                return self.cancelled
            return False

    prescription_id = uuid4()
    prescription_item_id = uuid4()
    schedule = PrescriptionSchedule(
        prescription_id=prescription_id,
        prescription_version=2,
        prescription_item_id=prescription_item_id,
        medication_reference=str(prescription_item_id),
        start_date=date(2026, 8, 24),
        duration_days=1,
        frequency="once_daily",
        time_zone="UTC",
    )
    occurrence = generate_medication_occurrences(schedule)[0]
    executor = Executor()
    store = PostgresReminderOccurrenceStore(executor)
    assert store.upsert(occurrence)
    assert "reminder_occurrences" in executor.executed[0][0]
    assert "prescription_item_id" in executor.executed[0][0]
    assert store.is_cancelled(occurrence.occurrence_id)

    email = DeterministicFakeEmailAdapter()
    resolver = InMemoryTrustedDataResolver(
        prescriptions={f"{prescription_id}:2": schedule},
    )
    dispatcher = MedicationReminderDispatcher(
        resolver=resolver, email=email, occurrence_store=store
    )
    result = dispatcher.dispatch(
        MedicationReminderRequest(
            prescription_id=prescription_id,
            prescription_version=2,
            occurrence_id=occurrence.occurrence_id,
        ),
        idempotency_key="event:cancelled-occurrence",
    )
    assert result.error_code == "REMINDER_CANCELLED"
    assert email.calls == []


def test_payload_boundary_rejects_nested_phi_and_provider_secrets() -> None:
    for payload in (
        {"template_key": "appointment_update", "nested": {"notes": "synthetic"}},
        {"template_key": "appointment_update", "recipient": "synthetic@example.test"},
    ):
        with pytest.raises(ValidationError):
            envelope(EventType.EMAIL_NOTIFICATION.value, payload)
