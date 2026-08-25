"""Focused API/security and API-to-worker contract checks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from healthcare_api.auth import verify_access_token
from healthcare_api.booking import (
    _availability_conflict_reason,
    _integrity_constraint_name,
    _slot_conflict_from_integrity,
)
from healthcare_api.config import Settings
from healthcare_api.domain import deterministic_occurrences
from healthcare_api.domain_schemas import PatientVisitResponse, VisitUpdateRequest
from healthcare_api.errors import ApiError
from healthcare_api.main import app
from healthcare_api.models import PrescriptionItem
from healthcare_api.repositories import _assert_reference_payload

WORKER_SRC = Path(__file__).parents[2] / "worker" / "src"
if str(WORKER_SRC) not in sys.path:
    sys.path.insert(0, str(WORKER_SRC))


def _token(claims: dict[str, object], secret: str) -> str:
    def encode(value: object) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    header = encode({"alg": "HS256", "typ": "JWT"})
    body = encode(claims)
    signing_input = f"{header}.{body}".encode()
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{body}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def test_supabase_jwt_checks_signature_issuer_audience_and_expiry() -> None:
    settings = Settings(
        supabase_jwt_secret="synthetic-secret",
        supabase_jwt_issuer="https://synthetic.supabase.co/auth/v1",
        supabase_jwt_audience="authenticated",
    )
    claims = {
        "sub": "synthetic-subject",
        "iss": settings.supabase_jwt_issuer,
        "aud": settings.supabase_jwt_audience,
        "exp": 4_102_444_800,
    }
    assert (
        verify_access_token(_token(claims, "synthetic-secret"), settings)["sub"]
        == "synthetic-subject"
    )

    for invalid in (
        {**claims, "iss": "https://wrong.example"},
        {**claims, "aud": "wrong"},
        {**claims, "exp": 1},
    ):
        with pytest.raises(ApiError) as raised:
            verify_access_token(_token(invalid, "synthetic-secret"), settings)
        assert raised.value.code == "AUTHENTICATION_REQUIRED"


def test_env_example_matches_api_jwt_settings() -> None:
    environment: dict[str, str] = {}
    for raw_line in (Path(__file__).parents[3] / ".env.example").read_text().splitlines():
        line = raw_line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            environment[key] = value

    assert environment["SUPABASE_JWT_ISSUER"].endswith("/auth/v1")
    assert environment["SUPABASE_JWT_AUDIENCE"] == "authenticated"
    assert "SUPABASE_JWT_PUBLIC_KEY" in environment
    assert environment["AUTH_ALLOW_LOCAL_TEST_TOKENS"] == "true"
    assert "SUPABASE_URL" not in environment


def test_medication_schedule_uses_only_structured_frequency() -> None:
    item = PrescriptionItem(
        id=uuid4(),
        prescription_id=uuid4(),
        medication_name="Synthetic medicine",
        dosage="10 mg",
        frequency="twice_daily",
        start_date=date(2026, 8, 24),
        duration_days=2,
        instructions="Synthetic instructions; generated prose is ignored.",
    )
    occurrences = deterministic_occurrences(item, "Asia/Kolkata")
    assert len(occurrences) == 4
    assert occurrences[0]["occurrence_at"].hour == 3
    assert occurrences[1]["occurrence_at"].hour == 15


def test_worker_event_envelope_rejects_phi_and_accepts_reference_payload() -> None:
    from healthcare_worker.envelope import EventEnvelope

    event_id = uuid4()
    envelope = EventEnvelope(
        version=1,
        event_id=event_id,
        correlation_id="request.synthetic",
        aggregate_id=uuid4(),
        event_type="calendar.sync",
        payload={"appointment_id": str(uuid4()), "event_label": "Healthcare appointment"},
    )
    assert envelope.deduplication_key == str(event_id)
    with pytest.raises(ValueError):
        EventEnvelope(
            version=1,
            event_id=uuid4(),
            correlation_id="request.synthetic",
            aggregate_id=uuid4(),
            event_type="email.notification",
            payload={"symptoms_text": "synthetic clinical text"},
        )


def test_api_llm_event_task_kinds_match_worker_contract() -> None:
    from healthcare_worker.ports import ClinicalSummaryRequest

    for task_kind in ("pre_visit", "post_visit", "plain_language_summary"):
        request = ClinicalSummaryRequest(
            source_record_reference=uuid4(), source_version=1, task_kind=task_kind
        )
        assert request.task_kind == task_kind
    for legacy_task_kind, canonical_task_kind in (
        ("pre_visit_brief", "pre_visit"),
        ("post_visit_summary", "post_visit"),
    ):
        request = ClinicalSummaryRequest.model_validate({"task_kind": legacy_task_kind})
        assert request.task_kind == canonical_task_kind
    with pytest.raises(ValidationError):
        ClinicalSummaryRequest.model_validate({"task_kind": "unsupported_summary"})


def test_api_runtime_image_has_import_migration_and_health_support() -> None:
    api_root = Path(__file__).parents[1]
    dockerfile = (api_root / "Dockerfile").read_text()
    dockerignore = (api_root / ".dockerignore").read_text()
    assert "uv sync --frozen --no-dev" in dockerfile
    assert "import healthcare_api" in dockerfile
    assert "alembic" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "USER 10001:10001" in dockerfile
    assert "tests/" in dockerignore
    assert ".env" in dockerignore
    assert (api_root / "src" / "healthcare_api" / "py.typed").is_file()


def test_api_outbox_payload_guard_rejects_raw_contact_data() -> None:
    _assert_reference_payload({"appointment_id": str(uuid4()), "recipient_reference": str(uuid4())})
    with pytest.raises(ValueError):
        _assert_reference_payload({"recipient_reference": "synthetic@example.test"})
    with pytest.raises(ValueError):
        _assert_reference_payload({"notes_ref": str(uuid4())})


def test_asyncpg_exclusion_constraint_maps_to_safe_slot_conflict() -> None:
    class RawAsyncpgError:
        constraint_name = "ex_slot_holds_active_overlap"

    class AdaptedDbapiError:
        __cause__ = RawAsyncpgError()

    error = IntegrityError(
        "INSERT ... synthetic value ...",
        {"value": "synthetic clinical text"},
        AdaptedDbapiError(),
    )
    doctor_id = uuid4()

    assert _integrity_constraint_name(error) == "ex_slot_holds_active_overlap"
    conflict = _slot_conflict_from_integrity(error, doctor_id)
    assert conflict is not None
    assert conflict.status_code == 409
    assert conflict.code == "SLOT_CONFLICT"
    assert conflict.details == {"doctor_id": str(doctor_id)}
    assert "synthetic" not in conflict.message


def test_availability_conflict_reason_prioritizes_leave_over_booking() -> None:
    slot_start = datetime(2026, 8, 24, 10, tzinfo=UTC)
    slot_end = slot_start + timedelta(minutes=30)
    blockers = [
        ("appointment", slot_start, slot_end),
        ("leave", slot_start, slot_end),
    ]

    assert _availability_conflict_reason(blockers, slot_start, slot_end) == (
        "Doctor on approved leave"
    )
    assert (
        _availability_conflict_reason([("hold", slot_start, slot_end)], slot_start, slot_end)
        == "Slot booked"
    )
    assert _availability_conflict_reason([], slot_start, slot_end) is None
    assert (
        _availability_conflict_reason(
            [("appointment", slot_end, slot_end + timedelta(minutes=30))], slot_start, slot_end
        )
        is None
    )


def test_openapi_marks_all_idempotent_commands_with_required_header() -> None:
    required_operations = {
        "createHold",
        "releaseHold",
        "confirmHold",
        "applyDoctorLeave",
        "updateDoctorLeave",
        "deleteDoctorLeave",
        "cancelAppointment",
        "rescheduleAppointment",
        "openAppointmentVisit",
        "completeVisit",
        "amendVisit",
        "retryIntegrationOperation",
    }
    operations = {
        operation.get("operationId"): operation
        for path in app.openapi()["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and operation.get("operationId") in required_operations
    }
    assert required_operations == operations.keys()
    assert all(
        any(
            parameter.get("name") == "Idempotency-Key" and parameter.get("required")
            for parameter in operation.get("parameters", [])
        )
        for operation in operations.values()
    )


def test_openapi_documents_protected_error_envelopes_and_collection_views() -> None:
    openapi = app.openapi()
    operations = {
        operation.get("operationId"): operation
        for path in openapi["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and operation.get("operationId")
    }
    protected = {
        "cancelAppointment",
        "rescheduleAppointment",
        "getAppointmentVisit",
        "openAppointmentVisit",
        "updateVisit",
        "completeVisit",
        "amendVisit",
        "listDoctorLeave",
        "applyDoctorLeave",
        "updateDoctorLeave",
        "deleteDoctorLeave",
        "retryIntegrationOperation",
    }
    expected_errors = {"401", "403", "404", "409", "422", "500"}
    for operation_id in protected:
        assert expected_errors <= set(operations[operation_id]["responses"])
        for status_code in expected_errors:
            schema = operations[operation_id]["responses"][status_code]["content"][
                "application/json"
            ]["schema"]
            assert schema["$ref"].endswith("/ErrorResponse")

    leave_schema = operations["listDoctorLeave"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ]
    assert leave_schema["$ref"].endswith("/LeaveListResponse")
    availability_schema = operations["getDoctorAvailability"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert availability_schema["$ref"].endswith("/AvailabilityResponse")
    doctor_search_parameters = {
        parameter["name"]: parameter for parameter in operations["searchDoctors"]["parameters"]
    }
    assert doctor_search_parameters["search"]["in"] == "query"
    assert "query" not in doctor_search_parameters

    ready = operations["getHealthReady"]["responses"]
    assert ready["503"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")


def test_patient_visit_projection_has_no_doctor_only_fields() -> None:
    payload = {
        "id": uuid4(),
        "appointment_id": uuid4(),
        "doctor_id": uuid4(),
        "status": "completed",
        "version": 3,
        "urgency": "routine",
        "follow_up_instructions": "Return in three weeks with a fasting lipid profile.",
        "prescription": None,
        "generated_artifacts": [],
        "created_at": "2026-08-24T08:30:00Z",
        "updated_at": "2026-08-24T09:00:00Z",
        "completed_at": "2026-08-24T09:00:00Z",
    }
    projection = PatientVisitResponse.model_validate(payload)
    assert projection.follow_up_instructions == (
        "Return in three weeks with a fasting lipid profile."
    )
    assert not hasattr(projection, "notes")
    assert not hasattr(projection, "advisory_text")
    with pytest.raises(ValidationError):
        PatientVisitResponse.model_validate({**payload, "notes": [{"notes_text": "secret"}]})

    with pytest.raises(ValidationError):
        PatientVisitResponse.model_validate(
            {
                **payload,
                "generated_artifacts": [
                    {
                        "id": uuid4(),
                        "artifact_type": "pre_visit_brief",
                        "status": "succeeded",
                        "content": "clinician-only brief",
                        "created_at": "2026-08-24T08:30:00Z",
                        "updated_at": "2026-08-24T09:00:00Z",
                    }
                ],
            }
        )


def test_visit_follow_up_instructions_are_optional_and_bounded() -> None:
    request = VisitUpdateRequest(
        expected_version=1,
        notes_text="Synthetic clinical note",
        follow_up_instructions="Return in three weeks.",
    )
    assert request.follow_up_instructions == "Return in three weeks."

    with pytest.raises(ValidationError):
        VisitUpdateRequest(
            expected_version=1,
            notes_text="Synthetic clinical note",
            follow_up_instructions="x" * 10001,
        )
