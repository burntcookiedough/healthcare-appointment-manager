"""Application-domain services for role-isolated profiles, clinical workflows, and leave."""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, time, timedelta
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import ActorContext
from .booking import (
    BookingService,
    ServiceResult,
    _actor_uuid,
    _ensure_utc,
    _now,
    _patient_uuid,
    _slot_conflict_from_integrity,
)
from .config import Settings
from .errors import ApiError
from .models import (
    Actor,
    Appointment,
    AppointmentHistory,
    Doctor,
    DoctorLeave,
    DoctorWorkingHour,
    GeneratedArtifact,
    IdempotencyRecord,
    IntegrationOperation,
    LeavePreview,
    OutboxEvent,
    PatientProfile,
    Prescription,
    PrescriptionItem,
    ReminderOccurrence,
    ReminderPreference,
    SlotHold,
    SymptomVersion,
    Visit,
    VisitNoteVersion,
)
from .repositories import (
    add_audit_event,
    add_outbox_event,
    get_doctor_for_booking,
    list_active_appointments,
    list_active_holds,
    lock_doctor_booking_lane,
)


def _uuid(value: UUID | str) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.") from exc


def _safe_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ApiError(422, "VALIDATION_FAILED", "The requested time zone is invalid.") from exc


def _wire(value: Any) -> dict[str, Any]:
    return cast(dict[str, Any], jsonable_encoder(value))


def _error_result(error: ApiError) -> ServiceResult:
    return ServiceResult(error.status_code, {}, error=error)


def _event_type(channel: str) -> str:
    return {
        "email": "email.notification",
        "calendar": "calendar.sync",
        "llm": "llm.summary",
        "appointment_reminder": "appointment.reminder",
        "medication_reminder": "medication.reminder",
    }.get(channel, "email.notification")


class DomainService:
    """Transactional service layer used by the role-specific routers."""

    def __init__(
        self, session: AsyncSession, settings: Settings, request_id: str | None = None
    ) -> None:
        self.session = session
        self.settings = settings
        self.request_id = request_id or "system"

    async def _run_idempotent(
        self,
        actor: ActorContext,
        *,
        method: str,
        route_template: str,
        idempotency_key: str | None,
        fingerprint_data: dict[str, Any],
        operation: Callable[[IdempotencyRecord], Awaitable[ServiceResult]],
    ) -> ServiceResult:
        """Reuse the booking idempotency fence for all domain mutations."""

        return await BookingService(self.session, self.settings, self.request_id)._run_idempotent(
            actor,
            method=method,
            route_template=route_template,
            idempotency_key=idempotency_key,
            fingerprint_data=fingerprint_data,
            operation=operation,
        )

    @staticmethod
    def _raise(result: ServiceResult) -> dict[str, Any]:
        if result.error is not None:
            raise result.error
        return result.body

    async def me(self, actor: ActorContext) -> dict[str, Any]:
        return {
            "subject_id": actor.subject_id,
            "role": actor.role,
            "available_roles": [actor.role],
            "profile_id": actor.patient_id or actor.doctor_id,
        }

    async def get_profile(self, actor: ActorContext) -> dict[str, Any]:
        patient_id = _patient_uuid(actor)
        async with self.session.begin():
            profile = await self.session.get(PatientProfile, patient_id)
            if profile is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            return _wire(
                {
                    "id": profile.actor_id,
                    "version": _version(profile),
                    "created_at": profile.created_at,
                    "updated_at": profile.updated_at,
                    "display_name": profile.display_name,
                    "timezone": profile.timezone,
                }
            )

    async def update_profile(self, actor: ActorContext, request: Any) -> dict[str, Any]:
        patient_id = _patient_uuid(actor)
        async with self.session.begin():
            profile = await self.session.get(PatientProfile, patient_id, with_for_update=True)
            if profile is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            version = _version(profile)
            if version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The resource was updated by another request.",
                    details={"current_version": version},
                )
            if request.display_name is not None:
                profile.display_name = request.display_name
            if request.timezone is not None:
                _safe_zone(request.timezone)
                profile.timezone = request.timezone
            profile.version += 1
            _bump_version(profile)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="patient.profile.updated",
                resource_type="patient_profile",
                resource_id=profile.actor_id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return _wire(
                {
                    "id": profile.actor_id,
                    "version": _version(profile),
                    "created_at": profile.created_at,
                    "updated_at": profile.updated_at,
                    "display_name": profile.display_name,
                    "timezone": profile.timezone,
                }
            )

    async def list_doctors(
        self, *, search: str | None = None, active_only: bool = True
    ) -> list[dict[str, Any]]:
        async with self.session.begin():
            statement = select(Doctor).order_by(Doctor.display_name, Doctor.id)
            if active_only:
                statement = statement.where(Doctor.is_active.is_(True))
            if search:
                pattern = f"%{search.strip()}%"
                statement = statement.where(
                    or_(Doctor.display_name.ilike(pattern), Doctor.specialization.ilike(pattern))
                )
            doctors = list((await self.session.execute(statement)).scalars())
            return [_doctor_dict(doctor) for doctor in doctors]

    async def get_doctor(
        self, doctor_id: UUID, *, include_inactive: bool = False
    ) -> dict[str, Any]:
        async with self.session.begin():
            doctor = await self.session.get(Doctor, doctor_id)
            if doctor is None or (not doctor.is_active and not include_inactive):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            return _doctor_dict(doctor)

    async def create_doctor(
        self, actor: ActorContext, request: Any, idempotency_key: str | None
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            existing_actor = await self.session.scalar(
                select(Actor).where(Actor.subject_id == request.subject_id)
            )
            if existing_actor is None or not existing_actor.is_active:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if existing_actor.role != "doctor":
                raise ApiError(
                    409, "INVALID_STATE_TRANSITION", "The subject is not provisioned as a doctor."
                )
            if (
                await self.session.scalar(
                    select(Doctor.id).where(Doctor.actor_id == existing_actor.id)
                )
                is not None
            ):
                raise ApiError(
                    409, "INVALID_STATE_TRANSITION", "The doctor profile already exists."
                )
            _safe_zone(request.timezone)
            doctor = Doctor(
                actor_id=existing_actor.id,
                display_name=request.display_name,
                credentials=request.credentials,
                specialization=request.specialization,
                timezone=request.timezone,
                appointment_durations_minutes=sorted(set(request.appointment_durations_minutes)),
            )
            self.session.add(doctor)
            await self.session.flush()
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.created",
                resource_type="doctor",
                resource_id=doctor.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(201, _wire(_doctor_dict(doctor)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /doctors",
                idempotency_key=idempotency_key,
                fingerprint_data=_wire(request.model_dump()),
                operation=operation,
            )
        )

    async def update_doctor(
        self, actor: ActorContext, doctor_id: UUID, request: Any
    ) -> dict[str, Any]:
        async with self.session.begin():
            doctor = await self.session.get(Doctor, doctor_id, with_for_update=True)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            version = _version(doctor)
            if version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The resource was updated by another request.",
                    details={"current_version": version},
                )
            if request.timezone is not None:
                _safe_zone(request.timezone)
                doctor.timezone = request.timezone
            if request.is_active is False and doctor.is_active:
                now = await _now(self.session)
                future_count = await self.session.scalar(
                    select(func.count(Appointment.id)).where(
                        Appointment.doctor_id == doctor.id,
                        Appointment.status.in_(("confirmed", "in_progress")),
                        Appointment.starts_at > now,
                    )
                )
                if future_count:
                    raise ApiError(
                        409,
                        "INVALID_STATE_TRANSITION",
                        "Resolve future appointments before disabling this doctor.",
                    )
            for field in ("display_name", "credentials", "specialization", "is_active"):
                value = getattr(request, field)
                if value is not None:
                    setattr(doctor, field, value)
            doctor.version += 1
            _bump_version(doctor)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.updated",
                resource_type="doctor",
                resource_id=doctor.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return _wire(_doctor_dict(doctor))

    async def get_working_hours(self, doctor_id: UUID) -> dict[str, Any]:
        async with self.session.begin():
            doctor = await self.session.get(Doctor, doctor_id)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            hours = list(
                (
                    await self.session.execute(
                        select(DoctorWorkingHour)
                        .where(DoctorWorkingHour.doctor_id == doctor_id)
                        .order_by(DoctorWorkingHour.weekday, DoctorWorkingHour.starts_local)
                    )
                ).scalars()
            )
            return {
                "doctor_id": doctor.id,
                "version": doctor.schedule_version,
                "timezone": doctor.timezone,
                "appointment_durations_minutes": list(doctor.appointment_durations_minutes or []),
                "intervals": [
                    {
                        "weekday": item.weekday,
                        "starts_local": item.starts_local,
                        "ends_local": item.ends_local,
                    }
                    for item in hours
                ],
            }

    async def replace_working_hours(
        self, actor: ActorContext, doctor_id: UUID, request: Any
    ) -> dict[str, Any]:
        async with self.session.begin():
            await lock_doctor_booking_lane(self.session, doctor_id)
            doctor = await self.session.get(Doctor, doctor_id, with_for_update=True)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if doctor.schedule_version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The schedule was updated by another request.",
                    details={"current_version": doctor.schedule_version},
                )
            timezone = request.timezone or doctor.timezone
            _safe_zone(timezone)
            durations = request.appointment_durations_minutes
            if durations is not None:
                doctor.appointment_durations_minutes = sorted(set(durations))
            doctor.timezone = timezone
            now = await _now(self.session)
            future_appointments = list(
                (
                    await self.session.execute(
                        select(Appointment).where(
                            Appointment.doctor_id == doctor.id,
                            Appointment.status.in_(("confirmed", "in_progress")),
                            Appointment.starts_at > now,
                        )
                    )
                ).scalars()
            )
            zone = _safe_zone(timezone)
            accepted_durations = doctor.appointment_durations_minutes or []
            for appointment in future_appointments:
                local_start = appointment.starts_at.astimezone(zone)
                local_end = appointment.ends_at.astimezone(zone)
                duration = int((appointment.ends_at - appointment.starts_at).total_seconds() // 60)
                if (
                    duration not in accepted_durations
                    or local_start.date() != local_end.date()
                    or not any(
                        interval.weekday == local_start.weekday()
                        and local_start.timetz().replace(tzinfo=None) >= interval.starts_local
                        and local_end.timetz().replace(tzinfo=None) <= interval.ends_local
                        for interval in request.intervals
                    )
                ):
                    raise ApiError(
                        409,
                        "INVALID_STATE_TRANSITION",
                        "The new working hours conflict with a future appointment.",
                    )
            await self.session.execute(
                delete(DoctorWorkingHour).where(DoctorWorkingHour.doctor_id == doctor_id)
            )
            for item in request.intervals:
                self.session.add(
                    DoctorWorkingHour(
                        doctor_id=doctor_id,
                        weekday=item.weekday,
                        starts_local=item.starts_local,
                        ends_local=item.ends_local,
                    )
                )
            doctor.schedule_version += 1
            doctor.version += 1
            _bump_version(doctor)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.working_hours.replaced",
                resource_type="doctor",
                resource_id=doctor.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return {
                "doctor_id": doctor.id,
                "version": doctor.schedule_version,
                "timezone": doctor.timezone,
                "appointment_durations_minutes": list(doctor.appointment_durations_minutes or []),
                "intervals": [
                    {
                        "weekday": item.weekday,
                        "starts_local": item.starts_local,
                        "ends_local": item.ends_local,
                    }
                    for item in request.intervals
                ],
            }

    async def leave_preview(
        self, actor: ActorContext, doctor_id: UUID, request: Any
    ) -> dict[str, Any]:
        async with self.session.begin():
            doctor = await self.session.get(Doctor, doctor_id)
            if doctor is None or not doctor.is_active:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            now = await _now(self.session)
            holds = list(
                (
                    await self.session.execute(
                        select(SlotHold).where(
                            SlotHold.doctor_id == doctor_id,
                            SlotHold.status == "active",
                            SlotHold.expires_at > now,
                            SlotHold.starts_at < request.ends_at,
                            SlotHold.ends_at > request.starts_at,
                        )
                    )
                ).scalars()
            )
            appointments = list(
                (
                    await self.session.execute(
                        select(Appointment).where(
                            Appointment.doctor_id == doctor_id,
                            Appointment.status.in_(("confirmed", "in_progress")),
                            Appointment.starts_at < request.ends_at,
                            Appointment.ends_at > request.starts_at,
                        )
                    )
                ).scalars()
            )
            raw_token = secrets.token_urlsafe(32)
            preview = LeavePreview(
                token_hash=_hash_token(raw_token),
                doctor_id=doctor_id,
                starts_at=request.starts_at,
                ends_at=request.ends_at,
                expected_schedule_version=doctor.schedule_version,
                affected_hold_ids=[str(item.id) for item in holds],
                affected_appointment_ids=[str(item.id) for item in appointments],
                expires_at=now + timedelta(minutes=10),
                created_by_actor_id=_actor_uuid(actor),
            )
            self.session.add(preview)
            await self.session.flush()
            return {
                "preview_token": raw_token,
                "doctor_id": doctor_id,
                "expected_schedule_version": doctor.schedule_version,
                "starts_at": request.starts_at,
                "ends_at": request.ends_at,
                "affected_hold_ids": [item.id for item in holds],
                "affected_appointment_ids": [item.id for item in appointments],
                "affected_hold_count": len(holds),
                "affected_appointment_count": len(appointments),
                "expires_at": preview.expires_at,
            }

    async def apply_leave(
        self,
        actor: ActorContext,
        doctor_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            await lock_doctor_booking_lane(self.session, doctor_id)
            doctor = await self.session.get(Doctor, doctor_id, with_for_update=True)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            preview = await self.session.scalar(
                select(LeavePreview)
                .where(
                    LeavePreview.doctor_id == doctor_id,
                    LeavePreview.token_hash == _hash_token(request.preview_token),
                )
                .with_for_update()
            )
            now = await _now(self.session)
            if preview is None:
                raise ApiError(409, "LEAVE_PREVIEW_STALE", "The leave preview is stale or invalid.")
            if (
                preview.used_at is not None
                or preview.expires_at <= now
                or doctor.schedule_version != request.expected_version
                or doctor.schedule_version != preview.expected_schedule_version
            ):
                raise ApiError(409, "LEAVE_PREVIEW_STALE", "The leave preview is stale or invalid.")
            leave = DoctorLeave(
                doctor_id=doctor_id,
                starts_at=preview.starts_at,
                ends_at=preview.ends_at,
                reason=request.reason,
            )
            self.session.add(leave)
            await self.session.flush()
            await self.session.execute(
                update(SlotHold)
                .where(
                    SlotHold.doctor_id == doctor_id,
                    SlotHold.status == "active",
                    SlotHold.expires_at > now,
                    SlotHold.starts_at < preview.ends_at,
                    SlotHold.ends_at > preview.starts_at,
                )
                .values(status="expired", version=SlotHold.version + 1, updated_at=now)
            )
            appointments = list(
                (
                    await self.session.execute(
                        select(Appointment)
                        .where(
                            Appointment.doctor_id == doctor_id,
                            Appointment.status == "confirmed",
                            Appointment.starts_at < preview.ends_at,
                            Appointment.ends_at > preview.starts_at,
                        )
                        .with_for_update()
                    )
                ).scalars()
            )
            for appointment in appointments:
                old_status = appointment.status
                appointment.status = "cancelled_doctor_leave"
                appointment.version += 1
                _bump_version(appointment)
                self.session.add(
                    AppointmentHistory(
                        appointment_id=appointment.id,
                        from_status=old_status,
                        to_status=appointment.status,
                        reason="doctor_leave",
                        actor_id=_actor_uuid(actor),
                    )
                )
                calendar_reference = await self._calendar_event_reference(appointment)
                await self._queue_integration(
                    appointment,
                    channel="email",
                    dedupe_key=f"appointment-leave-email:{appointment.id}:{leave.id}",
                    payload={
                        "appointment_id": str(appointment.id),
                        "template_key": "appointment_cancelled_doctor_leave",
                        "recipient_reference": str(appointment.patient_id),
                    },
                )
                await self._queue_integration(
                    appointment,
                    channel="calendar",
                    dedupe_key=f"appointment-leave-calendar:{appointment.id}:{leave.id}",
                    payload={
                        "appointment_id": str(appointment.id),
                        "event_label": "Healthcare appointment cancellation",
                        "time_zone": "UTC",
                        "action": "delete",
                        "provider_event_reference": calendar_reference or str(appointment.id),
                    },
                )
            doctor.schedule_version += 1
            doctor.version += 1
            _bump_version(doctor)
            preview.used_at = now
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.leave.applied",
                resource_type="doctor_leave",
                resource_id=leave.id,
                request_id=self.request_id,
                outcome="succeeded",
                reason={"affected_appointments": len(appointments)},
            )
            return ServiceResult(201, _wire(_leave_dict(leave)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /doctors/{doctor_id}/leave",
                idempotency_key=idempotency_key,
                fingerprint_data={
                    "doctor_id": str(doctor_id),
                    "preview_token_hash": _hash_token(request.preview_token),
                    **_wire(request.model_dump(exclude={"preview_token"})),
                },
                operation=operation,
            )
        )

    async def list_leaves(self, doctor_id: UUID) -> list[dict[str, Any]]:
        async with self.session.begin():
            rows = list(
                (
                    await self.session.execute(
                        select(DoctorLeave)
                        .where(DoctorLeave.doctor_id == doctor_id, DoctorLeave.is_active.is_(True))
                        .order_by(DoctorLeave.starts_at)
                    )
                ).scalars()
            )
            return [_leave_dict(item) for item in rows]

    async def edit_leave(
        self,
        actor: ActorContext,
        doctor_id: UUID,
        leave_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            await lock_doctor_booking_lane(self.session, doctor_id)
            doctor = await self.session.get(Doctor, doctor_id, with_for_update=True)
            leave = await self.session.get(DoctorLeave, leave_id, with_for_update=True)
            if (
                doctor is None
                or leave is None
                or leave.doctor_id != doctor_id
                or not leave.is_active
            ):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            preview = await self.session.scalar(
                select(LeavePreview)
                .where(
                    LeavePreview.doctor_id == doctor_id,
                    LeavePreview.token_hash == _hash_token(request.preview_token),
                )
                .with_for_update()
            )
            now = await _now(self.session)
            if (
                preview is None
                or preview.used_at is not None
                or preview.expires_at <= now
                or doctor.schedule_version != preview.expected_schedule_version
                or leave.version != request.expected_version
                or (request.starts_at is not None and request.starts_at != preview.starts_at)
                or (request.ends_at is not None and request.ends_at != preview.ends_at)
            ):
                raise ApiError(409, "LEAVE_PREVIEW_STALE", "The leave preview is stale or invalid.")
            leave.starts_at = preview.starts_at
            leave.ends_at = preview.ends_at
            if leave.starts_at >= leave.ends_at:
                raise ApiError(422, "VALIDATION_FAILED", "The leave interval must be non-empty.")
            if request.reason is not None:
                leave.reason = request.reason

            await self.session.execute(
                update(SlotHold)
                .where(
                    SlotHold.doctor_id == doctor_id,
                    SlotHold.status == "active",
                    SlotHold.expires_at > now,
                    SlotHold.starts_at < leave.ends_at,
                    SlotHold.ends_at > leave.starts_at,
                )
                .values(status="expired", version=SlotHold.version + 1, updated_at=now)
            )
            appointments = list(
                (
                    await self.session.execute(
                        select(Appointment)
                        .where(
                            Appointment.doctor_id == doctor_id,
                            Appointment.status == "confirmed",
                            Appointment.starts_at < leave.ends_at,
                            Appointment.ends_at > leave.starts_at,
                        )
                        .with_for_update()
                    )
                ).scalars()
            )
            for appointment in appointments:
                old_status = appointment.status
                appointment.status = "cancelled_doctor_leave"
                appointment.version += 1
                _bump_version(appointment)
                self.session.add(
                    AppointmentHistory(
                        appointment_id=appointment.id,
                        from_status=old_status,
                        to_status=appointment.status,
                        reason="doctor_leave",
                        actor_id=_actor_uuid(actor),
                    )
                )
                calendar_reference = await self._calendar_event_reference(appointment)
                await self._queue_integration(
                    appointment,
                    channel="email",
                    dedupe_key=(
                        f"appointment-leave-email:{appointment.id}:{leave.id}:{leave.version + 1}"
                    ),
                    payload={
                        "appointment_id": str(appointment.id),
                        "template_key": "appointment_cancelled_doctor_leave",
                        "recipient_reference": str(appointment.patient_id),
                    },
                )
                await self._queue_integration(
                    appointment,
                    channel="calendar",
                    dedupe_key=(
                        f"appointment-leave-calendar:{appointment.id}:{leave.id}:"
                        f"{leave.version + 1}"
                    ),
                    payload={
                        "appointment_id": str(appointment.id),
                        "event_label": "Healthcare appointment cancellation",
                        "time_zone": "UTC",
                        "action": "delete",
                        "provider_event_reference": calendar_reference or str(appointment.id),
                    },
                )
            leave.version += 1
            _bump_version(leave)
            doctor.schedule_version += 1
            doctor.version += 1
            _bump_version(doctor)
            preview.used_at = now
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.leave.updated",
                resource_type="doctor_leave",
                resource_id=leave.id,
                request_id=self.request_id,
                outcome="succeeded",
                reason={"affected_appointments": len(appointments)},
            )
            return ServiceResult(200, _wire(_leave_dict(leave)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="PATCH",
                route_template="PATCH /doctors/{doctor_id}/leave/{leave_id}",
                idempotency_key=idempotency_key,
                fingerprint_data={
                    "doctor_id": str(doctor_id),
                    "leave_id": str(leave_id),
                    "preview_token_hash": _hash_token(request.preview_token),
                    **_wire(request.model_dump(exclude={"preview_token"})),
                },
                operation=operation,
            )
        )

    async def delete_leave(
        self,
        actor: ActorContext,
        doctor_id: UUID,
        leave_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> None:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            await lock_doctor_booking_lane(self.session, doctor_id)
            doctor = await self.session.get(Doctor, doctor_id, with_for_update=True)
            leave = await self.session.get(DoctorLeave, leave_id, with_for_update=True)
            if (
                doctor is None
                or leave is None
                or leave.doctor_id != doctor_id
                or not leave.is_active
            ):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            preview = await self.session.scalar(
                select(LeavePreview)
                .where(
                    LeavePreview.doctor_id == doctor_id,
                    LeavePreview.token_hash == _hash_token(request.preview_token),
                )
                .with_for_update()
            )
            now = await _now(self.session)
            if (
                preview is None
                or preview.used_at is not None
                or preview.expires_at <= now
                or doctor.schedule_version != preview.expected_schedule_version
                or leave.version != request.expected_version
                or preview.starts_at != leave.starts_at
                or preview.ends_at != leave.ends_at
            ):
                raise ApiError(409, "LEAVE_PREVIEW_STALE", "The leave preview is stale or invalid.")
            leave.is_active = False
            leave.version += 1
            _bump_version(leave)
            doctor.schedule_version += 1
            doctor.version += 1
            _bump_version(doctor)
            preview.used_at = now
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="doctor.leave.deleted",
                resource_type="doctor_leave",
                resource_id=leave.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(204, {})

        result = await self._run_idempotent(
            actor,
            method="DELETE",
            route_template="DELETE /doctors/{doctor_id}/leave/{leave_id}",
            idempotency_key=idempotency_key,
            fingerprint_data={
                "doctor_id": str(doctor_id),
                "leave_id": str(leave_id),
                "preview_token_hash": _hash_token(request.preview_token),
                "expected_version": request.expected_version,
            },
            operation=operation,
        )
        self._raise(result)

    async def _appointment_for(
        self, actor: ActorContext, appointment_id: UUID, *, lock: bool = False
    ) -> Appointment:
        statement = select(Appointment).where(Appointment.id == appointment_id)
        if actor.role == "patient":
            statement = statement.where(Appointment.patient_id == _patient_uuid(actor))
        elif actor.role == "doctor":
            statement = statement.where(Appointment.doctor_id == _uuid(actor.doctor_id or ""))
        if lock:
            statement = statement.with_for_update()
        appointment = await self.session.scalar(statement)
        if appointment is None:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        return appointment

    async def list_appointments(
        self,
        actor: ActorContext,
        *,
        status: str | None = None,
        from_at: datetime | None = None,
        to_at: datetime | None = None,
    ) -> list[dict[str, Any]]:
        if from_at is not None:
            from_at = _ensure_utc(from_at)
        if to_at is not None:
            to_at = _ensure_utc(to_at)
        if from_at is not None and to_at is not None and from_at >= to_at:
            raise ApiError(422, "VALIDATION_FAILED", "The appointment range is invalid.")
        async with self.session.begin():
            statement = select(Appointment).order_by(Appointment.starts_at, Appointment.id)
            if actor.role == "patient":
                statement = statement.where(Appointment.patient_id == _patient_uuid(actor))
            elif actor.role == "doctor":
                statement = statement.where(Appointment.doctor_id == _uuid(actor.doctor_id or ""))
            if status:
                statement = statement.where(Appointment.status == status)
            if from_at is not None:
                statement = statement.where(Appointment.ends_at > from_at)
            if to_at is not None:
                statement = statement.where(Appointment.starts_at < to_at)
            return [
                _appointment_summary(item)
                for item in (await self.session.execute(statement)).scalars()
            ]

    async def appointment_detail(self, actor: ActorContext, appointment_id: UUID) -> dict[str, Any]:
        async with self.session.begin():
            appointment = await self._appointment_for(actor, appointment_id)
            visit_id = await self.session.scalar(
                select(Visit.id).where(Visit.appointment_id == appointment.id)
            )
            artifacts = list(
                (
                    await self.session.execute(
                        select(GeneratedArtifact)
                        .where(GeneratedArtifact.appointment_id == appointment.id)
                        .order_by(GeneratedArtifact.created_at)
                    )
                ).scalars()
            )
            body = _appointment_summary(appointment)
            body["symptoms_text"] = (
                appointment.symptoms_text if actor.role in {"patient", "doctor"} else None
            )
            body["visit_id"] = visit_id
            body["generated_artifacts"] = [
                _artifact_dict(item, include_content=actor.role in {"patient", "doctor"})
                for item in artifacts
            ]
            return body

    async def cancel_appointment(
        self,
        actor: ActorContext,
        appointment_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            appointment = await self._appointment_for(actor, appointment_id, lock=True)
            if appointment.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The appointment was updated by another request.",
                    details={"current_version": appointment.version},
                )
            if appointment.status not in {"confirmed", "in_progress"}:
                raise ApiError(
                    409,
                    "INVALID_STATE_TRANSITION",
                    "The appointment cannot be cancelled in its current state.",
                )
            target = {
                "patient_request": "cancelled_patient",
                "doctor_request": "cancelled_doctor",
                "admin_request": "cancelled_admin",
                "safety": "cancelled_admin",
            }[request.reason_code]
            if actor.role == "patient" and request.reason_code != "patient_request":
                raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
            if actor.role == "doctor" and request.reason_code != "doctor_request":
                raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
            if actor.role == "admin" and request.reason_code not in {"admin_request", "safety"}:
                raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
            old_status = appointment.status
            appointment.status = target
            appointment.version += 1
            _bump_version(appointment)
            self.session.add(
                AppointmentHistory(
                    appointment_id=appointment.id,
                    from_status=old_status,
                    to_status=target,
                    reason=request.reason_code,
                    actor_id=_actor_uuid(actor),
                )
            )
            calendar_reference = await self._calendar_event_reference(appointment)
            await self._queue_integration(
                appointment,
                channel="email",
                dedupe_key=f"appointment-cancel-email:{appointment.id}:{appointment.version}",
                payload={
                    "appointment_id": str(appointment.id),
                    "template_key": "appointment_cancelled",
                    "recipient_reference": str(appointment.patient_id),
                },
            )
            await self._queue_integration(
                appointment,
                channel="calendar",
                dedupe_key=f"appointment-cancel-calendar:{appointment.id}:{appointment.version}",
                payload={
                    "appointment_id": str(appointment.id),
                    "event_label": "Healthcare appointment cancellation",
                    "time_zone": "UTC",
                    "action": "delete",
                    "provider_event_reference": calendar_reference or str(appointment.id),
                },
            )
            return ServiceResult(200, _wire(_appointment_summary(appointment)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /appointments/{appointment_id}/cancel",
                idempotency_key=idempotency_key,
                fingerprint_data={
                    "appointment_id": str(appointment_id),
                    **_wire(request.model_dump()),
                },
                operation=operation,
            )
        )

    async def reschedule_appointment(
        self,
        actor: ActorContext,
        appointment_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            appointment = await self._appointment_for(actor, appointment_id, lock=True)
            if appointment.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The appointment was updated by another request.",
                    details={"current_version": appointment.version},
                )
            if appointment.status not in {"confirmed", "in_progress"}:
                raise ApiError(
                    409,
                    "INVALID_STATE_TRANSITION",
                    "The appointment cannot be rescheduled in its current state.",
                )
            await lock_doctor_booking_lane(self.session, appointment.doctor_id)
            doctor = await get_doctor_for_booking(self.session, appointment.doctor_id)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            new_starts = request.starts_at.astimezone(UTC)
            new_ends = new_starts + timedelta(minutes=request.duration_minutes)
            BookingService(self.session, self.settings, self.request_id)._validate_duration(
                doctor, request.duration_minutes
            )
            await BookingService(self.session, self.settings, self.request_id)._validate_schedule(
                doctor, new_starts, new_ends
            )
            blockers = await list_active_appointments(
                self.session, doctor_id=doctor.id, starts_at=new_starts, ends_at=new_ends
            )
            blockers = [item for item in blockers if item.id != appointment.id]
            holds = await list_active_holds(
                self.session,
                doctor_id=doctor.id,
                starts_at=new_starts,
                ends_at=new_ends,
                now=await _now(self.session),
            )
            if blockers or holds:
                raise ApiError(
                    409,
                    "SLOT_CONFLICT",
                    "The selected time is no longer available.",
                    details={"doctor_id": str(doctor.id)},
                )
            old_starts, old_ends = appointment.starts_at, appointment.ends_at
            appointment.starts_at, appointment.ends_at = new_starts, new_ends
            appointment.version += 1
            _bump_version(appointment)
            self.session.add(
                AppointmentHistory(
                    appointment_id=appointment.id,
                    from_status=appointment.status,
                    to_status=appointment.status,
                    old_starts_at=old_starts,
                    old_ends_at=old_ends,
                    reason="rescheduled",
                    actor_id=_actor_uuid(actor),
                )
            )
            try:
                await self.session.flush()
            except IntegrityError as exc:
                conflict = _slot_conflict_from_integrity(exc, doctor.id)
                if conflict is not None:
                    raise conflict from exc
                raise
            calendar_reference = await self._calendar_event_reference(appointment)
            await self._queue_integration(
                appointment,
                channel="email",
                dedupe_key=f"appointment-reschedule-email:{appointment.id}:{appointment.version}",
                payload={
                    "appointment_id": str(appointment.id),
                    "template_key": "appointment_rescheduled",
                    "recipient_reference": str(appointment.patient_id),
                },
            )
            await self._queue_integration(
                appointment,
                channel="calendar",
                dedupe_key=f"appointment-reschedule-calendar:{appointment.id}:{appointment.version}",
                payload={
                    "appointment_id": str(appointment.id),
                    "starts_at": new_starts.isoformat(),
                    "ends_at": new_ends.isoformat(),
                    "time_zone": "UTC",
                    "event_label": "Healthcare appointment",
                    "action": "update",
                    "provider_event_reference": calendar_reference or str(appointment.id),
                },
            )
            return ServiceResult(200, _wire(_appointment_summary(appointment)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /appointments/{appointment_id}/reschedule",
                idempotency_key=idempotency_key,
                fingerprint_data={
                    "appointment_id": str(appointment_id),
                    **_wire(request.model_dump()),
                },
                operation=operation,
            )
        )

    async def add_symptoms(
        self, actor: ActorContext, appointment_id: UUID, request: Any
    ) -> dict[str, Any]:
        async with self.session.begin():
            appointment = await self._appointment_for(actor, appointment_id, lock=True)
            if actor.role != "patient":
                raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
            latest = (
                await self.session.scalar(
                    select(func.max(SymptomVersion.version)).where(
                        SymptomVersion.appointment_id == appointment.id
                    )
                )
                or 0
            )
            symptom = SymptomVersion(
                appointment_id=appointment.id,
                version=int(latest) + 1,
                symptoms_text=request.symptoms_text,
                created_by_actor_id=_actor_uuid(actor),
            )
            self.session.add(symptom)
            if request.urgency is not None:
                appointment.urgency = request.urgency
                appointment.version += 1
                _bump_version(appointment)
            await self.session.flush()
            return {
                "id": symptom.id,
                "version": symptom.version,
                "symptoms_text": symptom.symptoms_text,
                "source": symptom.source,
                "created_at": symptom.created_at,
            }

    async def get_symptoms(self, actor: ActorContext, appointment_id: UUID) -> dict[str, Any]:
        async with self.session.begin():
            appointment = await self._appointment_for(actor, appointment_id)
            rows = list(
                (
                    await self.session.execute(
                        select(SymptomVersion)
                        .where(SymptomVersion.appointment_id == appointment.id)
                        .order_by(SymptomVersion.version)
                    )
                ).scalars()
            )
            if not rows:
                symptom_items: list[dict[str, Any]] = [
                    {
                        "id": appointment.id,
                        "version": 1,
                        "symptoms_text": appointment.symptoms_text,
                        "source": "patient",
                        "created_at": appointment.created_at,
                    }
                ]
            else:
                symptom_items = [
                    {
                        "id": item.id,
                        "version": item.version,
                        "symptoms_text": item.symptoms_text,
                        "source": item.source,
                        "created_at": item.created_at,
                    }
                    for item in rows
                ]
            artifacts = list(
                (
                    await self.session.execute(
                        select(GeneratedArtifact)
                        .where(
                            GeneratedArtifact.appointment_id == appointment.id,
                            GeneratedArtifact.artifact_type == "pre_visit_brief",
                        )
                        .order_by(GeneratedArtifact.created_at)
                    )
                ).scalars()
            )
            return {
                "items": symptom_items,
                "generated_artifacts": [
                    _artifact_dict(item, include_content=actor.role in {"patient", "doctor"})
                    for item in artifacts
                ],
            }

    async def open_visit(
        self, actor: ActorContext, appointment_id: UUID, idempotency_key: str | None
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            appointment = await self._appointment_for(actor, appointment_id, lock=True)
            if actor.role != "doctor":
                raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
            if appointment.status not in {"confirmed", "in_progress"}:
                raise ApiError(
                    409,
                    "INVALID_STATE_TRANSITION",
                    "A visit cannot be opened for this appointment.",
                )
            existing = await self.session.scalar(
                select(Visit).where(Visit.appointment_id == appointment.id).with_for_update()
            )
            if existing is None:
                existing = Visit(appointment_id=appointment.id, doctor_id=appointment.doctor_id)
                self.session.add(existing)
                await self.session.flush()
            if appointment.status == "confirmed":
                appointment.status = "in_progress"
                appointment.version += 1
                _bump_version(appointment)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="visit.opened",
                resource_type="visit",
                resource_id=existing.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(200, _wire(await self._visit_dict(existing, include_content=True)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /appointments/{appointment_id}/visit",
                idempotency_key=idempotency_key,
                fingerprint_data={"appointment_id": str(appointment_id)},
                operation=operation,
            )
        )

    async def get_visit(self, actor: ActorContext, appointment_id: UUID) -> dict[str, Any]:
        async with self.session.begin():
            appointment = await self._appointment_for(actor, appointment_id)
            if actor.role == "patient" and appointment.status != "completed":
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            visit = await self.session.scalar(
                select(Visit).where(Visit.appointment_id == appointment.id)
            )
            if visit is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if actor.role == "patient":
                return _wire(await self._patient_visit_dict(visit))
            return _wire(await self._visit_dict(visit, include_content=True))

    async def update_visit(
        self, actor: ActorContext, visit_id: UUID, request: Any
    ) -> dict[str, Any]:
        async with self.session.begin():
            visit = await self.session.scalar(
                select(Visit).where(Visit.id == visit_id).with_for_update()
            )
            if (
                visit is None
                or actor.role != "doctor"
                or visit.doctor_id != _uuid(actor.doctor_id or "")
            ):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if visit.status != "draft":
                raise ApiError(409, "INVALID_STATE_TRANSITION", "The completed visit is immutable.")
            if visit.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The visit was updated by another request.",
                    details={"current_version": visit.version},
                )
            latest = (
                await self.session.scalar(
                    select(func.max(VisitNoteVersion.version)).where(
                        VisitNoteVersion.visit_id == visit.id
                    )
                )
                or 0
            )
            self.session.add(
                VisitNoteVersion(
                    visit_id=visit.id,
                    version=int(latest) + 1,
                    notes_text=request.notes_text,
                    author_actor_id=_actor_uuid(actor),
                )
            )
            if request.urgency is not None:
                visit.urgency = request.urgency
            visit.version += 1
            _bump_version(visit)
            prescription = await self.session.scalar(
                select(Prescription).where(Prescription.visit_id == visit.id).with_for_update()
            )
            if request.prescription_items is not None or request.advisory_text is not None:
                if prescription is None:
                    prescription = Prescription(
                        visit_id=visit.id, version=1, advisory_text=request.advisory_text
                    )
                    self.session.add(prescription)
                    await self.session.flush()
                else:
                    prescription.version += 1
                    if request.advisory_text is not None:
                        prescription.advisory_text = request.advisory_text
                    _bump_version(prescription)
                    if request.prescription_items is not None:
                        await self.session.execute(
                            delete(PrescriptionItem).where(
                                PrescriptionItem.prescription_id == prescription.id
                            )
                        )
                    else:
                        await self.session.execute(
                            delete(ReminderOccurrence).where(
                                ReminderOccurrence.prescription_item_id.in_(
                                    select(PrescriptionItem.id).where(
                                        PrescriptionItem.prescription_id == prescription.id
                                    )
                                )
                            )
                        )
                if request.prescription_items is not None:
                    for item in request.prescription_items:
                        self.session.add(
                            _prescription_item(prescription.id, item, _actor_uuid(actor))
                        )
                await self.session.flush()
                current_items = list(
                    (
                        await self.session.execute(
                            select(PrescriptionItem)
                            .where(PrescriptionItem.prescription_id == prescription.id)
                            .order_by(PrescriptionItem.created_at, PrescriptionItem.id)
                        )
                    ).scalars()
                )
                await self._sync_reminder_occurrences(prescription, current_items)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="visit.updated",
                resource_type="visit",
                resource_id=visit.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return _wire(await self._visit_dict(visit, include_content=True))

    async def complete_visit(
        self, actor: ActorContext, visit_id: UUID, request: Any, idempotency_key: str | None
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            visit = await self.session.scalar(
                select(Visit).where(Visit.id == visit_id).with_for_update()
            )
            if (
                visit is None
                or actor.role != "doctor"
                or visit.doctor_id != _uuid(actor.doctor_id or "")
            ):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if visit.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The visit was updated by another request.",
                    details={"current_version": visit.version},
                )
            if visit.status == "completed":
                return ServiceResult(
                    200, _wire(await self._visit_dict(visit, include_content=True))
                )
            note_count = (
                await self.session.scalar(
                    select(func.count(VisitNoteVersion.id)).where(
                        VisitNoteVersion.visit_id == visit.id
                    )
                )
                or 0
            )
            if note_count < 1:
                raise ApiError(
                    422, "VALIDATION_FAILED", "A doctor note is required before completion."
                )
            latest_note = await self.session.scalar(
                select(VisitNoteVersion)
                .where(VisitNoteVersion.visit_id == visit.id)
                .order_by(VisitNoteVersion.version.desc())
                .limit(1)
            )
            if latest_note is None:
                raise ApiError(
                    422, "VALIDATION_FAILED", "A doctor note is required before completion."
                )
            appointment = await self.session.get(
                Appointment, visit.appointment_id, with_for_update=True
            )
            if appointment is None or appointment.status not in {"confirmed", "in_progress"}:
                raise ApiError(
                    409, "INVALID_STATE_TRANSITION", "The appointment cannot be completed."
                )
            visit.status = "completed"
            visit.completed_at = await _now(self.session)
            visit.version += 1
            _bump_version(visit)
            prescription = await self.session.scalar(
                select(Prescription).where(Prescription.visit_id == visit.id).with_for_update()
            )
            if prescription is not None:
                prescription.status = "completed"
                prescription.version += 1
                _bump_version(prescription)
            appointment.status = "completed"
            appointment.version += 1
            _bump_version(appointment)
            artifact = GeneratedArtifact(
                visit_id=visit.id,
                appointment_id=appointment.id,
                artifact_type="post_visit_summary",
                status="pending",
                source_record_type="visit_note",
                source_record_id=latest_note.id,
                source_versions={
                    "visit_version": visit.version,
                    "note_version": latest_note.version,
                },
                task_version="v1",
            )
            self.session.add(artifact)
            await self.session.flush()
            await self._queue_integration(
                appointment,
                channel="llm",
                dedupe_key=f"visit-post-summary:{visit.id}:{visit.version}",
                payload={
                    "source_record_reference": str(visit.id),
                    "source_version": visit.version,
                    "task_kind": "plain_language_summary",
                },
            )
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="visit.completed",
                resource_type="visit",
                resource_id=visit.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(200, _wire(await self._visit_dict(visit, include_content=True)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /visits/{visit_id}/complete",
                idempotency_key=idempotency_key,
                fingerprint_data={"visit_id": str(visit_id), **_wire(request.model_dump())},
                operation=operation,
            )
        )

    async def amend_visit(
        self,
        actor: ActorContext,
        visit_id: UUID,
        request: Any,
        idempotency_key: str | None,
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            visit = await self.session.scalar(
                select(Visit).where(Visit.id == visit_id).with_for_update()
            )
            if (
                visit is None
                or actor.role != "doctor"
                or visit.doctor_id != _uuid(actor.doctor_id or "")
            ):
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if visit.status != "completed" or visit.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The visit version is stale or immutable.",
                    details={"current_version": visit.version},
                )
            latest = (
                await self.session.scalar(
                    select(func.max(VisitNoteVersion.version)).where(
                        VisitNoteVersion.visit_id == visit.id
                    )
                )
                or 0
            )
            self.session.add(
                VisitNoteVersion(
                    visit_id=visit.id,
                    version=int(latest) + 1,
                    notes_text=request.notes_text,
                    author_actor_id=_actor_uuid(actor),
                )
            )
            visit.version += 1
            _bump_version(visit)
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="visit.amended",
                resource_type="visit",
                resource_id=visit.id,
                request_id=self.request_id,
                outcome="succeeded",
                reason={"reason": request.reason},
            )
            await self.session.flush()
            return ServiceResult(200, _wire(await self._visit_dict(visit, include_content=True)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /visits/{visit_id}/amendments",
                idempotency_key=idempotency_key,
                fingerprint_data={"visit_id": str(visit_id), **_wire(request.model_dump())},
                operation=operation,
            )
        )

    async def get_reminder_preferences(self, actor: ActorContext) -> dict[str, Any]:
        patient_id = _patient_uuid(actor)
        async with self.session.begin():
            preference = await self.session.scalar(
                select(ReminderPreference).where(ReminderPreference.patient_id == patient_id)
            )
            if preference is None:
                return {
                    "patient_id": patient_id,
                    "version": 1,
                    "enabled": False,
                    "channel": "email",
                    "timezone": "UTC",
                    "local_times": [time(9, 0)],
                    "created_at": datetime.now(UTC),
                    "updated_at": datetime.now(UTC),
                }
            return _reminder_pref_dict(preference)

    async def update_reminder_preferences(
        self, actor: ActorContext, request: Any
    ) -> dict[str, Any]:
        patient_id = _patient_uuid(actor)
        async with self.session.begin():
            preference = await self.session.scalar(
                select(ReminderPreference)
                .where(ReminderPreference.patient_id == patient_id)
                .with_for_update()
            )
            if preference is None:
                if request.expected_version != 1:
                    raise ApiError(
                        409,
                        "VERSION_CONFLICT",
                        "The preferences were updated by another request.",
                        details={"current_version": 1},
                    )
                preference = ReminderPreference(
                    patient_id=patient_id,
                    enabled=request.enabled,
                    channel=request.channel,
                    timezone=request.timezone,
                    local_times=request.local_times,
                )
                _safe_zone(request.timezone)
                self.session.add(preference)
            else:
                if preference.version != request.expected_version:
                    raise ApiError(
                        409,
                        "VERSION_CONFLICT",
                        "The preferences were updated by another request.",
                        details={"current_version": preference.version},
                    )
                _safe_zone(request.timezone)
                (
                    preference.enabled,
                    preference.channel,
                    preference.timezone,
                    preference.local_times,
                ) = request.enabled, request.channel, request.timezone, request.local_times
                preference.version += 1
                _bump_version(preference)
            await self.session.flush()
            event = await add_outbox_event(
                self.session,
                event_type="medication.reminder",
                aggregate_type="patient",
                aggregate_id=patient_id,
                dedupe_key=f"reminder-preferences:{patient_id}:{preference.version}",
                payload={
                    "template_key": "medication_reminder_reconcile",
                    "recipient_reference": str(patient_id),
                    "appointment_id": None,
                },
                correlation_id=self.request_id,
            )
            self.session.add(
                IntegrationOperation(
                    outbox_event_id=event.id,
                    channel="medication_reminder",
                    state="pending",
                    version=1,
                )
            )
            return _reminder_pref_dict(preference)

    async def reminder_schedule(
        self, actor: ActorContext, prescription_id: UUID, limit: int = 100
    ) -> dict[str, Any]:
        async with self.session.begin():
            prescription = await self.session.scalar(
                select(Prescription).where(Prescription.id == prescription_id).with_for_update()
            )
            if prescription is None:
                item, patient_id = await self._prescription_item_for_actor(actor, prescription_id)
                prescription_id = item.prescription_id
                items = [item]
            else:
                patient_id = await self._assert_prescription_access(actor, prescription)
                items = list(
                    (
                        await self.session.execute(
                            select(PrescriptionItem)
                            .where(PrescriptionItem.prescription_id == prescription.id)
                            .order_by(PrescriptionItem.created_at, PrescriptionItem.id)
                        )
                    ).scalars()
                )
            pref = await self.session.scalar(
                select(ReminderPreference).where(ReminderPreference.patient_id == patient_id)
            )
            timezone = pref.timezone if pref else "UTC"
            occurrences: list[dict[str, Any]] = []
            for item in items:
                remaining = limit - len(occurrences)
                if remaining <= 0:
                    break
                occurrences.extend(
                    {
                        **occurrence,
                        "prescription_item_id": item.id,
                        "prescription_version": prescription.version
                        if prescription is not None
                        else occurrence["prescription_version"],
                    }
                    for occurrence in deterministic_occurrences(item, timezone, limit=remaining)
                )
            return {
                "prescription_id": prescription_id,
                "prescription_item_id": items[0].id if len(items) == 1 else None,
                "items": occurrences,
            }

    async def _assert_prescription_access(
        self, actor: ActorContext, prescription: Prescription
    ) -> UUID:
        row = await self.session.execute(
            select(Appointment.patient_id, Visit.doctor_id)
            .join(Visit, Visit.appointment_id == Appointment.id)
            .where(Visit.id == prescription.visit_id)
        )
        record = row.one_or_none()
        if record is None:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        patient_id, doctor_id = record
        if actor.role == "patient" and patient_id != _patient_uuid(actor):
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        if actor.role == "doctor" and doctor_id != _uuid(actor.doctor_id or ""):
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        return cast(UUID, patient_id)

    async def _prescription_item_for_actor(
        self, actor: ActorContext, item_id: UUID
    ) -> tuple[PrescriptionItem, UUID]:
        row = await self.session.execute(
            select(PrescriptionItem, Appointment.patient_id)
            .join(Prescription, Prescription.id == PrescriptionItem.prescription_id)
            .join(Visit, Visit.id == Prescription.visit_id)
            .join(Appointment, Appointment.id == Visit.appointment_id)
            .where(PrescriptionItem.id == item_id)
        )
        record = row.one_or_none()
        if record is None:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        item, patient_id = record
        prescription = await self.session.get(Prescription, item.prescription_id)
        if prescription is None:
            raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
        await self._assert_prescription_access(actor, prescription)
        return item, patient_id

    async def _sync_reminder_occurrences(
        self, prescription: Prescription, items: list[PrescriptionItem]
    ) -> None:
        """Persist a bounded deterministic reminder projection for a draft prescription."""

        patient_id = await self._assert_prescription_access(
            ActorContext(id="system", subject_id="system", role="admin"), prescription
        )
        preference = await self.session.scalar(
            select(ReminderPreference).where(ReminderPreference.patient_id == patient_id)
        )
        if preference is None:
            profile = await self.session.get(PatientProfile, patient_id)
            timezone = profile.timezone if profile is not None else "UTC"
        else:
            timezone = preference.timezone
        for item in items:
            for occurrence in deterministic_occurrences(item, timezone, limit=10000):
                occurrence_at = cast(datetime, occurrence["occurrence_at"])
                self.session.add(
                    ReminderOccurrence(
                        prescription_item_id=item.id,
                        prescription_version=prescription.version,
                        occurrence_at=occurrence_at,
                        dedupe_key=(
                            f"{item.id}:{prescription.version}:{occurrence_at.isoformat()}"
                        ),
                    )
                )

    async def appointment_integrations(
        self, actor: ActorContext, appointment_id: UUID
    ) -> list[dict[str, Any]]:
        async with self.session.begin():
            appointment = await self._appointment_for(actor, appointment_id)
            rows = list(
                (
                    await self.session.execute(
                        select(IntegrationOperation)
                        .where(IntegrationOperation.appointment_id == appointment.id)
                        .order_by(IntegrationOperation.created_at)
                    )
                ).scalars()
            )
            return [_integration_dict(item) for item in rows]

    async def admin_integrations(
        self, *, state: str | None = None, channel: str | None = None
    ) -> list[dict[str, Any]]:
        async with self.session.begin():
            statement = select(IntegrationOperation).order_by(
                IntegrationOperation.updated_at, IntegrationOperation.id
            )
            if state:
                statement = statement.where(IntegrationOperation.state == state)
            if channel:
                statement = statement.where(IntegrationOperation.channel == channel)
            return [
                _integration_dict(item)
                for item in (await self.session.execute(statement)).scalars()
            ]

    async def retry_integration(
        self, actor: ActorContext, operation_id: UUID, request: Any, idempotency_key: str | None
    ) -> dict[str, Any]:
        async def operation(_: IdempotencyRecord) -> ServiceResult:
            row = await self.session.scalar(
                select(IntegrationOperation)
                .where(IntegrationOperation.id == operation_id)
                .with_for_update()
            )
            if row is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if row.version != request.expected_version:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "The integration operation was updated by another request.",
                    details={"current_version": row.version},
                )
            if row.state != "failed":
                raise ApiError(
                    409, "INVALID_STATE_TRANSITION", "Only failed integration work can be retried."
                )
            row.state, row.attempt_count = "pending", row.attempt_count + 1
            row.last_attempt_at = await _now(self.session)
            row.version += 1
            _bump_version(row)
            outbox = await self.session.get(OutboxEvent, row.outbox_event_id, with_for_update=True)
            if outbox is not None:
                outbox.status = "pending"
                outbox.attempt_count += 1
                outbox.version += 1
                outbox.next_attempt_at = row.last_attempt_at
                outbox.last_error_code = None
            return ServiceResult(200, _wire(_integration_dict(row)))

        return self._raise(
            await self._run_idempotent(
                actor,
                method="POST",
                route_template="POST /admin/integrations/{operation_id}/retry",
                idempotency_key=idempotency_key,
                fingerprint_data={"operation_id": str(operation_id), **_wire(request.model_dump())},
                operation=operation,
            )
        )

    async def _queue_integration(
        self, appointment: Appointment, *, channel: str, dedupe_key: str, payload: dict[str, Any]
    ) -> IntegrationOperation:
        event = await add_outbox_event(
            self.session,
            event_type=_event_type(channel),
            aggregate_type="appointment",
            aggregate_id=appointment.id,
            appointment_id=appointment.id,
            dedupe_key=dedupe_key,
            payload=payload,
            correlation_id=self.request_id,
        )
        operation = IntegrationOperation(
            appointment_id=appointment.id,
            outbox_event_id=event.id,
            channel=channel,
            state="pending",
        )
        self.session.add(operation)
        await self.session.flush()
        return operation

    async def _calendar_event_reference(self, appointment: Appointment) -> str | None:
        """Resolve the stable calendar event reference without exposing provider data.

        A successful worker projection stores the provider event reference on its
        integration operation.  Before that asynchronous projection completes, the
        worker can deterministically resolve the reference from the original outbox
        event UUID used as the calendar create idempotency key.
        """

        operation = await self.session.scalar(
            select(IntegrationOperation)
            .where(
                IntegrationOperation.appointment_id == appointment.id,
                IntegrationOperation.channel == "calendar",
            )
            .order_by(IntegrationOperation.created_at.desc())
        )
        if operation is None:
            return None
        if operation.provider_reference:
            return operation.provider_reference
        event = await self.session.get(OutboxEvent, operation.outbox_event_id)
        if event is not None:
            payload_reference = event.payload.get("provider_event_reference")
            if isinstance(payload_reference, str) and payload_reference:
                return payload_reference
        # Direct ``calendar.sync`` rows use the durable event UUID as the worker
        # idempotency key, which is also the provider event ID supplied on create.
        return hashlib.sha256(str(operation.outbox_event_id).encode()).hexdigest()[:32]

    async def _visit_dict(self, visit: Visit, *, include_content: bool) -> dict[str, Any]:
        notes = list(
            (
                await self.session.execute(
                    select(VisitNoteVersion)
                    .where(VisitNoteVersion.visit_id == visit.id)
                    .order_by(VisitNoteVersion.version)
                )
            ).scalars()
        )
        prescription = await self.session.scalar(
            select(Prescription).where(Prescription.visit_id == visit.id)
        )
        items: list[PrescriptionItem] = []
        if prescription is not None:
            items = list(
                (
                    await self.session.execute(
                        select(PrescriptionItem)
                        .where(PrescriptionItem.prescription_id == prescription.id)
                        .order_by(PrescriptionItem.created_at)
                    )
                ).scalars()
            )
        artifacts = list(
            (
                await self.session.execute(
                    select(GeneratedArtifact).where(GeneratedArtifact.visit_id == visit.id)
                )
            ).scalars()
        )
        return {
            "id": visit.id,
            "appointment_id": visit.appointment_id,
            "doctor_id": visit.doctor_id,
            "status": visit.status,
            "version": visit.version,
            "urgency": visit.urgency,
            "created_at": visit.created_at,
            "updated_at": visit.updated_at,
            "completed_at": visit.completed_at,
            "notes": [
                {
                    "id": item.id,
                    "version": item.version,
                    "notes_text": item.notes_text if include_content else None,
                    "created_at": item.created_at,
                }
                for item in notes
            ],
            "prescription": None
            if prescription is None
            else {
                "id": prescription.id,
                "version": prescription.version,
                "status": prescription.status,
                "advisory_text": prescription.advisory_text if include_content else None,
                "items": [
                    {
                        "id": item.id,
                        "medication_name": item.medication_name,
                        "dosage": item.dosage,
                        "route": item.route,
                        "frequency": item.frequency,
                        "start_date": item.start_date,
                        "end_date": item.end_date,
                        "duration_days": item.duration_days,
                        "instructions": item.instructions if include_content else "",
                    }
                    for item in items
                ],
            },
            "generated_artifacts": [
                _artifact_dict(item, include_content=include_content) for item in artifacts
            ],
        }

    async def _patient_visit_dict(self, visit: Visit) -> dict[str, Any]:
        """Build the intentionally narrow completed-visit patient projection."""

        prescription = await self.session.scalar(
            select(Prescription).where(Prescription.visit_id == visit.id)
        )
        items: list[PrescriptionItem] = []
        if prescription is not None:
            items = list(
                (
                    await self.session.execute(
                        select(PrescriptionItem)
                        .where(PrescriptionItem.prescription_id == prescription.id)
                        .order_by(PrescriptionItem.created_at)
                    )
                ).scalars()
            )
        artifacts = list(
            (
                await self.session.execute(
                    select(GeneratedArtifact)
                    .where(
                        GeneratedArtifact.visit_id == visit.id,
                        GeneratedArtifact.artifact_type == "post_visit_summary",
                    )
                    .order_by(GeneratedArtifact.created_at)
                )
            ).scalars()
        )
        return {
            "id": visit.id,
            "appointment_id": visit.appointment_id,
            "doctor_id": visit.doctor_id,
            "status": "completed",
            "version": visit.version,
            "urgency": visit.urgency,
            "prescription": None
            if prescription is None
            else {
                "id": prescription.id,
                "version": prescription.version,
                "status": prescription.status,
                "items": [
                    {
                        "id": item.id,
                        "medication_name": item.medication_name,
                        "dosage": item.dosage,
                        "route": item.route,
                        "frequency": item.frequency,
                        "start_date": item.start_date,
                        "end_date": item.end_date,
                        "duration_days": item.duration_days,
                        "instructions": item.instructions,
                    }
                    for item in items
                ],
            },
            "generated_artifacts": [
                {
                    "id": item.id,
                    "artifact_type": item.artifact_type,
                    "status": item.status,
                    "content": item.content,
                    "created_at": item.created_at,
                    "updated_at": item.updated_at,
                }
                for item in artifacts
            ],
            "created_at": visit.created_at,
            "updated_at": visit.updated_at,
            "completed_at": visit.completed_at,
        }


def _version(row: Any) -> int:
    return int(getattr(row, "version", 1))


def _bump_version(row: Any) -> None:
    # SQLAlchemy's TimestampMixin onupdate is applied at flush; assigning it here
    # keeps in-memory response objects honest for idempotency snapshots.
    row.updated_at = datetime.now(UTC)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _doctor_dict(doctor: Doctor) -> dict[str, Any]:
    return {
        "id": doctor.id,
        "version": doctor.version,
        "created_at": doctor.created_at,
        "updated_at": doctor.updated_at,
        "display_name": doctor.display_name,
        "credentials": doctor.credentials,
        "specialization": doctor.specialization,
        "timezone": doctor.timezone,
        "appointment_durations_minutes": list(doctor.appointment_durations_minutes or []),
        "is_active": doctor.is_active,
    }


def _leave_dict(leave: DoctorLeave) -> dict[str, Any]:
    return {
        "id": leave.id,
        "version": leave.version,
        "doctor_id": leave.doctor_id,
        "starts_at": leave.starts_at,
        "ends_at": leave.ends_at,
        "reason": leave.reason,
        "is_active": leave.is_active,
        "created_at": leave.created_at,
        "updated_at": leave.updated_at,
    }


def _appointment_summary(appointment: Appointment) -> dict[str, Any]:
    return {
        "id": appointment.id,
        "version": appointment.version,
        "patient_id": appointment.patient_id,
        "doctor_id": appointment.doctor_id,
        "starts_at": appointment.starts_at,
        "ends_at": appointment.ends_at,
        "status": appointment.status,
        "urgency": appointment.urgency,
        "created_at": appointment.created_at,
        "updated_at": appointment.updated_at,
    }


def _artifact_dict(artifact: GeneratedArtifact, *, include_content: bool) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "artifact_type": artifact.artifact_type,
        "status": artifact.status,
        "content": artifact.content if include_content else None,
        "source_record_type": artifact.source_record_type,
        "source_record_id": artifact.source_record_id,
        "source_versions": artifact.source_versions,
        "task_version": artifact.task_version,
        "provider": artifact.provider,
        "model": artifact.model,
        "error_code": artifact.error_code,
        "created_at": artifact.created_at,
        "updated_at": artifact.updated_at,
    }


def _reminder_pref_dict(preference: ReminderPreference) -> dict[str, Any]:
    return {
        "patient_id": preference.patient_id,
        "version": preference.version,
        "enabled": preference.enabled,
        "channel": preference.channel,
        "timezone": preference.timezone,
        "local_times": list(preference.local_times or []),
        "created_at": preference.created_at,
        "updated_at": preference.updated_at,
    }


def _integration_dict(operation: IntegrationOperation) -> dict[str, Any]:
    return {
        "id": operation.id,
        "appointment_id": operation.appointment_id,
        "channel": operation.channel,
        "state": operation.state,
        "attempt_count": operation.attempt_count,
        "error_code": operation.error_code,
        "last_attempt_at": operation.last_attempt_at,
        "version": operation.version,
        "created_at": operation.created_at,
        "updated_at": operation.updated_at,
    }


def _prescription_item(prescription_id: UUID, request: Any, actor_id: UUID) -> PrescriptionItem:
    return PrescriptionItem(
        prescription_id=prescription_id,
        medication_name=request.medication_name,
        dosage=request.dosage,
        route=request.route,
        frequency=request.frequency,
        start_date=request.start_date,
        end_date=request.end_date,
        duration_days=request.duration_days,
        instructions=request.instructions,
        prescriber_actor_id=actor_id,
    )


def deterministic_occurrences(
    item: PrescriptionItem, timezone: str, *, limit: int = 100
) -> list[dict[str, Any]]:
    """Derive reminder instants from structured frequency/date fields only."""

    zone = _safe_zone(timezone)
    if item.frequency == "as_needed":
        return []
    times = {
        "once_daily": (time(9, 0),),
        "twice_daily": (time(9, 0), time(21, 0)),
        "three_times_daily": (time(8, 0), time(14, 0), time(20, 0)),
        "every_4_hours": tuple(time(hour, 0) for hour in range(0, 24, 4)),
    }[item.frequency]
    end_date = item.end_date or (item.start_date + timedelta(days=(item.duration_days or 30) - 1))
    output: list[dict[str, Any]] = []
    cursor = item.start_date
    while cursor <= end_date and len(output) < limit:
        for local_time in times:
            instant = datetime.combine(cursor, local_time, tzinfo=zone).astimezone(UTC)
            output.append(
                {"occurrence_at": instant, "status": "pending", "prescription_version": 1}
            )
            if len(output) >= limit:
                break
        cursor += timedelta(days=1)
    return output
