"""Explicit wire schemas for the Phase 1 API."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must include an explicit offset")
    return value.astimezone(UTC)


def _wire_datetime(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class HoldCreateRequest(StrictModel):
    doctor_id: UUID
    starts_at: datetime
    duration_minutes: Annotated[int, Field(ge=1, le=480)]

    @field_validator("starts_at")
    @classmethod
    def starts_at_is_aware(cls, value: datetime) -> datetime:
        return _utc(value)


class HoldConfirmRequest(StrictModel):
    symptoms_text: Annotated[str, Field(min_length=1, max_length=10000)]

    @field_validator("symptoms_text")
    @classmethod
    def symptoms_are_meaningful(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("symptoms_text must not be blank")
        return value


class AvailabilitySlot(StrictModel):
    doctor_id: UUID
    starts_at: datetime
    ends_at: datetime
    available: bool
    conflict_reason: str | None = None

    @field_validator("starts_at", "ends_at")
    @classmethod
    def output_timestamp_is_aware(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def interval_is_valid(self) -> AvailabilitySlot:
        if self.starts_at >= self.ends_at:
            raise ValueError("interval must be half-open and non-empty")
        return self

    @field_serializer("starts_at", "ends_at", when_used="json")
    def serialize_timestamp(self, value: datetime) -> str:
        return _wire_datetime(value)


class AvailabilityResponse(StrictModel):
    items: list[AvailabilitySlot]
    next_cursor: str | None = None


class HoldResponse(StrictModel):
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    patient_id: UUID
    doctor_id: UUID
    starts_at: datetime
    ends_at: datetime
    status: Literal["active", "released", "expired", "converted"]
    expires_at: datetime

    @field_validator("created_at", "updated_at", "starts_at", "ends_at", "expires_at")
    @classmethod
    def timestamps_are_aware(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_serializer(
        "created_at", "updated_at", "starts_at", "ends_at", "expires_at", when_used="json"
    )
    def serialize_timestamp(self, value: datetime) -> str:
        return _wire_datetime(value)


class AppointmentResponse(StrictModel):
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    patient_id: UUID
    doctor_id: UUID
    starts_at: datetime
    ends_at: datetime
    status: Literal[
        "confirmed",
        "in_progress",
        "completed",
        "cancelled_patient",
        "cancelled_doctor",
        "cancelled_admin",
        "cancelled_doctor_leave",
    ]
    symptoms_text: str

    @field_validator("created_at", "updated_at", "starts_at", "ends_at")
    @classmethod
    def timestamps_are_aware(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_serializer("created_at", "updated_at", "starts_at", "ends_at", when_used="json")
    def serialize_timestamp(self, value: datetime) -> str:
        return _wire_datetime(value)


class HealthResponse(StrictModel):
    status: Literal["ok"]


class ErrorFieldResponse(StrictModel):
    path: str
    code: str
    message: str


class ErrorResponseBody(StrictModel):
    code: str
    message: str
    fields: list[ErrorFieldResponse] | None = None
    retryable: bool = False
    details: dict[str, object] | None = None


class ErrorResponse(StrictModel):
    error: ErrorResponseBody
    request_id: str


# These are the stable error statuses emitted by the protected API boundary.  Keeping
# the response model on the router defaults makes the executable OpenAPI contract match
# the exception handlers instead of documenting only FastAPI's validation response.
COMMON_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse, "description": "The request is malformed."},
    401: {"model": ErrorResponse, "description": "Authentication is required."},
    403: {"model": ErrorResponse, "description": "The caller is not permitted."},
    404: {"model": ErrorResponse, "description": "The resource was not found."},
    409: {"model": ErrorResponse, "description": "The current state prevents the command."},
    422: {"model": ErrorResponse, "description": "Request validation failed."},
    429: {"model": ErrorResponse, "description": "The request was rate limited."},
    500: {"model": ErrorResponse, "description": "An unexpected server error occurred."},
}


class IdempotencyHeaders(StrictModel):
    """Documentation-only schema for the required mutation header."""

    idempotency_key: Annotated[str, Field(min_length=16, max_length=128)]


def dump_hold(hold: object) -> dict[str, object]:
    """Convert an ORM hold into the canonical response shape."""

    return HoldResponse.model_validate(hold).model_dump(mode="json")


def dump_appointment(appointment: object) -> dict[str, object]:
    """Convert an ORM appointment into the canonical response shape."""

    return AppointmentResponse.model_validate(appointment).model_dump(mode="json")
