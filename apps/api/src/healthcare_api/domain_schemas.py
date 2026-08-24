"""Explicit Pydantic wire models for profiles, clinical workflows, and operations."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_serializer, field_validator, model_validator

from .schemas import StrictModel, _utc, _wire_datetime


class WireModel(StrictModel):
    @field_serializer(
        "created_at",
        "updated_at",
        "starts_at",
        "ends_at",
        "expires_at",
        "completed_at",
        "occurrence_at",
        "sent_at",
        "last_attempt_at",
        when_used="json",
        check_fields=False,
    )
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return _wire_datetime(value) if value is not None else None


class VersionedRequest(StrictModel):
    expected_version: Annotated[int, Field(ge=1)]


class ProfileUpdateRequest(VersionedRequest):
    display_name: Annotated[str | None, Field(min_length=1, max_length=200)] = None
    timezone: Annotated[str | None, Field(min_length=1, max_length=64)] = None

    @model_validator(mode="after")
    def has_change(self) -> ProfileUpdateRequest:
        if self.display_name is None and self.timezone is None:
            raise ValueError("at least one profile field is required")
        return self


class UserContextResponse(StrictModel):
    subject_id: str
    role: Literal["patient", "doctor", "admin"]
    available_roles: list[Literal["patient", "doctor", "admin"]]
    profile_id: UUID | None = None


class PatientProfileResponse(WireModel):
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    display_name: str
    timezone: str


class DoctorCreateRequest(StrictModel):
    subject_id: Annotated[str, Field(min_length=1, max_length=200)]
    display_name: Annotated[str, Field(min_length=1, max_length=200)]
    credentials: Annotated[str | None, Field(max_length=500)] = None
    specialization: Annotated[str | None, Field(max_length=500)] = None
    timezone: Annotated[str, Field(min_length=1, max_length=64)] = "UTC"
    appointment_durations_minutes: list[Annotated[int, Field(ge=5, le=480)]] = [30]


class DoctorUpdateRequest(VersionedRequest):
    display_name: Annotated[str | None, Field(min_length=1, max_length=200)] = None
    credentials: Annotated[str | None, Field(max_length=500)] = None
    specialization: Annotated[str | None, Field(max_length=500)] = None
    timezone: Annotated[str | None, Field(min_length=1, max_length=64)] = None
    is_active: bool | None = None


class DoctorSummaryResponse(WireModel):
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    display_name: str
    credentials: str | None = None
    specialization: str | None = None
    timezone: str
    appointment_durations_minutes: list[int]
    is_active: bool
    # These public discovery fields are optional until their backing profile data is
    # provisioned; the API never invents values for them.
    avatar_url: str | None = None
    biography: str | None = None
    next_available_at: datetime | None = None


class DoctorListResponse(StrictModel):
    items: list[DoctorSummaryResponse]
    next_cursor: str | None = None


class WorkingHourInput(StrictModel):
    weekday: Annotated[int, Field(ge=0, le=6)]
    starts_local: time
    ends_local: time

    @model_validator(mode="after")
    def ordered(self) -> WorkingHourInput:
        if self.starts_local >= self.ends_local:
            raise ValueError("working-hours interval must be non-empty")
        return self


class WorkingHoursReplaceRequest(VersionedRequest):
    timezone: Annotated[str | None, Field(min_length=1, max_length=64)] = None
    appointment_durations_minutes: list[Annotated[int, Field(ge=5, le=480)]] | None = None
    intervals: list[WorkingHourInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def non_overlapping_intervals(self) -> WorkingHoursReplaceRequest:
        by_weekday: dict[int, list[WorkingHourInput]] = {}
        for interval in self.intervals:
            by_weekday.setdefault(interval.weekday, []).append(interval)
        for intervals in by_weekday.values():
            ordered = sorted(intervals, key=lambda item: item.starts_local)
            if any(
                left.ends_local > right.starts_local
                for left, right in zip(ordered, ordered[1:], strict=False)
            ):
                raise ValueError("working-hours intervals must not overlap")
        return self


class WorkingHoursResponse(StrictModel):
    doctor_id: UUID
    version: int
    timezone: str
    appointment_durations_minutes: list[int]
    intervals: list[WorkingHourInput]


class LeavePreviewRequest(StrictModel):
    starts_at: datetime
    ends_at: datetime
    reason: Annotated[str | None, Field(max_length=500)] = None

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        return _utc(value)

    @model_validator(mode="after")
    def ordered(self) -> LeavePreviewRequest:
        if self.starts_at >= self.ends_at:
            raise ValueError("leave interval must be non-empty")
        return self


class LeaveApplyRequest(StrictModel):
    preview_token: Annotated[str, Field(min_length=16, max_length=256)]
    expected_version: Annotated[int, Field(ge=1)]
    reason: Annotated[str | None, Field(max_length=500)] = None


class LeaveEditRequest(LeaveApplyRequest):
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("starts_at", "ends_at")
    @classmethod
    def aware(cls, value: datetime | None) -> datetime | None:
        return _utc(value) if value is not None else None


class LeaveResponse(WireModel):
    id: UUID
    version: int
    doctor_id: UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class LeaveListResponse(StrictModel):
    items: list[LeaveResponse]
    next_cursor: str | None = None


class LeaveImpactResponse(StrictModel):
    preview_token: str
    doctor_id: UUID
    expected_schedule_version: int
    starts_at: datetime
    ends_at: datetime
    affected_hold_ids: list[UUID]
    affected_appointment_ids: list[UUID]
    affected_hold_count: int
    affected_appointment_count: int
    expires_at: datetime

    @field_serializer("starts_at", "ends_at", "expires_at", when_used="json")
    def serialize_datetime(self, value: datetime) -> str:
        return _wire_datetime(value)


class AppointmentCancelRequest(VersionedRequest):
    reason_code: Literal["patient_request", "doctor_request", "admin_request", "safety"]
    note: Annotated[str | None, Field(max_length=500)] = None


class AppointmentRescheduleRequest(VersionedRequest):
    starts_at: datetime
    duration_minutes: Annotated[int, Field(ge=5, le=480)]

    @field_validator("starts_at")
    @classmethod
    def aware(cls, value: datetime) -> datetime:
        return _utc(value)


class SymptomIntakeRequest(StrictModel):
    symptoms_text: Annotated[str, Field(min_length=1, max_length=10000)]
    urgency: Literal["routine", "soon", "urgent"] | None = None

    @field_validator("symptoms_text")
    @classmethod
    def meaningful(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("symptoms_text must not be blank")
        return value


class SymptomVersionResponse(StrictModel):
    id: UUID
    version: int
    symptoms_text: str
    source: Literal["patient", "imported"]
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, value: datetime) -> str:
        return _wire_datetime(value)


class SymptomsResponse(StrictModel):
    items: list[SymptomVersionResponse]
    generated_artifacts: list[GeneratedArtifactResponse]


class PrescriptionItemInput(StrictModel):
    medication_name: Annotated[str, Field(min_length=1, max_length=200)]
    dosage: Annotated[str, Field(min_length=1, max_length=200)]
    route: Annotated[str | None, Field(max_length=80)] = None
    frequency: Literal[
        "once_daily", "twice_daily", "three_times_daily", "every_4_hours", "as_needed"
    ]
    start_date: date
    end_date: date | None = None
    duration_days: Annotated[int | None, Field(ge=1, le=3650)] = None
    instructions: Annotated[str, Field(min_length=1, max_length=1000)]

    @model_validator(mode="after")
    def valid_dates(self) -> PrescriptionItemInput:
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date must not precede start_date")
        return self


class VisitUpdateRequest(VersionedRequest):
    notes_text: Annotated[str, Field(min_length=1, max_length=30000)]
    urgency: Literal["routine", "soon", "urgent"] | None = None
    prescription_items: list[PrescriptionItemInput] | None = Field(default=None, max_length=100)
    advisory_text: Annotated[str | None, Field(max_length=10000)] = None


class VisitCompleteRequest(VersionedRequest):
    pass


class VisitAmendmentRequest(VersionedRequest):
    reason: Annotated[str, Field(min_length=1, max_length=1000)]
    notes_text: Annotated[str, Field(min_length=1, max_length=30000)]


class VisitNoteResponse(StrictModel):
    id: UUID
    version: int
    notes_text: str
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, value: datetime) -> str:
        return _wire_datetime(value)


class PrescriptionItemResponse(StrictModel):
    id: UUID
    medication_name: str
    dosage: str
    route: str | None = None
    frequency: str
    start_date: date
    end_date: date | None = None
    duration_days: int | None = None
    instructions: str


class PrescriptionResponse(StrictModel):
    id: UUID
    version: int
    status: Literal["draft", "completed"]
    advisory_text: str | None = None
    items: list[PrescriptionItemResponse]


class GeneratedArtifactResponse(WireModel):
    id: UUID
    artifact_type: Literal["pre_visit_brief", "post_visit_summary"]
    status: Literal["pending", "succeeded", "failed"]
    content: str | None = None
    source_record_type: str
    source_record_id: UUID
    source_versions: dict[str, object]
    task_version: str
    provider: str | None = None
    model: str | None = None
    error_code: str | None = None
    created_at: datetime
    updated_at: datetime


class PatientGeneratedArtifactResponse(WireModel):
    """Patient-safe generated output without provenance or provider internals."""

    id: UUID
    artifact_type: Literal["post_visit_summary"]
    status: Literal["pending", "succeeded", "failed"]
    content: str | None = None
    created_at: datetime
    updated_at: datetime


class PatientPrescriptionResponse(StrictModel):
    """Patient-visible structured medication instructions only."""

    id: UUID
    version: int
    status: Literal["draft", "completed"]
    items: list[PrescriptionItemResponse]


class PatientVisitResponse(WireModel):
    """Completed visit projection intended for the owning patient.

    Doctor-authored note text, internal advisory/diagnostic prose, and doctor-only
    prescription fields are deliberately absent from this model rather than being
    represented as nullable values.
    """

    id: UUID
    appointment_id: UUID
    doctor_id: UUID
    status: Literal["completed"]
    version: int
    urgency: str | None = None
    prescription: PatientPrescriptionResponse | None = None
    generated_artifacts: list[PatientGeneratedArtifactResponse]
    created_at: datetime
    updated_at: datetime
    completed_at: datetime


class VisitResponse(WireModel):
    id: UUID
    appointment_id: UUID
    doctor_id: UUID
    status: Literal["draft", "completed"]
    version: int
    urgency: str | None = None
    notes: list[VisitNoteResponse]
    prescription: PrescriptionResponse | None = None
    generated_artifacts: list[GeneratedArtifactResponse]
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class AppointmentSummaryResponse(WireModel):
    id: UUID
    version: int
    patient_id: UUID
    doctor_id: UUID
    starts_at: datetime
    ends_at: datetime
    status: str
    urgency: str | None = None
    created_at: datetime
    updated_at: datetime


class AppointmentDetailResponse(AppointmentSummaryResponse):
    symptoms_text: str | None = None
    visit_id: UUID | None = None
    generated_artifacts: list[GeneratedArtifactResponse] = Field(default_factory=list)


class AppointmentListResponse(StrictModel):
    items: list[AppointmentSummaryResponse]
    next_cursor: str | None = None


class ReminderPreferencesRequest(VersionedRequest):
    enabled: bool
    channel: Literal["email", "sms", "push"]
    timezone: Annotated[str, Field(min_length=1, max_length=64)]
    local_times: list[time] = Field(min_length=1, max_length=8)


class ReminderPreferencesResponse(WireModel):
    patient_id: UUID
    version: int
    enabled: bool
    channel: str
    timezone: str
    local_times: list[time]
    created_at: datetime
    updated_at: datetime


class ReminderOccurrenceResponse(StrictModel):
    prescription_item_id: UUID | None = None
    occurrence_at: datetime
    status: str
    prescription_version: int

    @field_serializer("occurrence_at", when_used="json")
    def serialize_occurrence_at(self, value: datetime) -> str:
        return _wire_datetime(value)


class ReminderScheduleResponse(StrictModel):
    prescription_id: UUID | None = None
    prescription_item_id: UUID | None = None
    items: list[ReminderOccurrenceResponse]


class IntegrationStatusResponse(WireModel):
    id: UUID
    appointment_id: UUID | None = None
    channel: str
    state: Literal["pending", "succeeded", "retrying", "failed"]
    attempt_count: int
    error_code: str | None = None
    last_attempt_at: datetime | None = None
    version: int
    created_at: datetime
    updated_at: datetime


class IntegrationListResponse(StrictModel):
    items: list[IntegrationStatusResponse]
    next_cursor: str | None = None


class IntegrationRetryRequest(VersionedRequest):
    pass


SymptomsResponse.model_rebuild()
