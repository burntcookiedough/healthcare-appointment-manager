"""Fast, dependency-free contract tests for the API boundary."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from healthcare_api.auth import ActorContext, get_current_actor
from healthcare_api.booking import _ensure_utc, _validate_key
from healthcare_api.errors import ApiError
from healthcare_api.main import app
from healthcare_api.schemas import HoldConfirmRequest


def test_liveness_has_request_id_and_no_dependency_details() -> None:
    client = TestClient(app)

    response = client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


def test_missing_auth_uses_stable_error_envelope() -> None:
    response = TestClient(app).get(f"/api/v1/holds/{uuid4()}")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"
    assert "authorization" not in response.text.lower()
    assert response.json()["request_id"] == response.headers["x-request-id"]


def test_validation_error_is_stable_and_does_not_echo_symptoms() -> None:
    actor = ActorContext(id=str(uuid4()), subject_id="synthetic-patient", role="patient")
    app.dependency_overrides[get_current_actor] = lambda: actor
    try:
        response = TestClient(app).post(
            "/api/v1/holds/00000000-0000-0000-0000-000000000001/confirm",
            json={"unexpected": "secret symptom text"},
            headers={"Idempotency-Key": "synthetic-validation-key"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert "secret symptom text" not in response.text


def test_aware_utc_normalization_rejects_offset_free_instants() -> None:
    value = datetime(2026, 8, 24, 12, 0, tzinfo=UTC)

    assert _ensure_utc(value) == value
    with pytest.raises(ApiError) as raised:
        _ensure_utc(datetime(2026, 8, 24, 12, 0))
    assert raised.value.code == "VALIDATION_FAILED"


def test_idempotency_key_is_opaque_and_bounded() -> None:
    assert _validate_key("synthetic-key-1234") == "synthetic-key-1234"
    with pytest.raises(ApiError, match="Idempotency-Key"):
        _validate_key("too-short")
    with pytest.raises(ApiError):
        _validate_key("contains space-1234")


def test_symptoms_are_preserved_without_whitespace_replacement() -> None:
    value = "  headache after exercise  "

    request = HoldConfirmRequest(symptoms_text=value)

    assert request.symptoms_text == value
