"""Focused API/security and API-to-worker contract checks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import sys
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest

from healthcare_api.auth import verify_access_token
from healthcare_api.config import Settings
from healthcare_api.domain import deterministic_occurrences
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


def test_api_outbox_payload_guard_rejects_raw_contact_data() -> None:
    _assert_reference_payload({"appointment_id": str(uuid4()), "recipient_reference": str(uuid4())})
    with pytest.raises(ValueError):
        _assert_reference_payload({"recipient_reference": "synthetic@example.test"})


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
