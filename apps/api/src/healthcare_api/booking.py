"""Booking domain services and repository orchestration."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import ActorContext
from .config import Settings
from .errors import ApiError, ErrorBody
from .models import (
    Appointment,
    Doctor,
    GeneratedArtifact,
    IdempotencyRecord,
    IntegrationOperation,
    SlotHold,
    SymptomVersion,
)
from .repositories import (
    add_audit_event,
    add_outbox_event,
    expire_active_holds,
    get_doctor_for_booking,
    list_active_appointments,
    list_active_holds,
    list_availability_blockers,
    list_leave_overlaps,
    lock_doctor_booking_lane,
    query_owned_hold,
    request_fingerprint,
    reserve_idempotency,
)
from .schemas import dump_appointment, dump_hold

logger = logging.getLogger(__name__)


def _integrity_constraint_name(exc: IntegrityError) -> str | None:
    """Read only the database constraint identifier, never the SQL/value text."""

    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    return str(name) if name else None


def _slot_conflict_from_integrity(exc: IntegrityError, doctor_id: UUID) -> ApiError | None:
    constraint = _integrity_constraint_name(exc)
    if constraint in {"ex_slot_holds_active_overlap", "ex_appointments_active_overlap"}:
        return ApiError(
            409,
            "SLOT_CONFLICT",
            "The selected time is no longer available.",
            details={"doctor_id": str(doctor_id)},
        )
    return None


@dataclass(slots=True)
class ServiceResult:
    """A completed HTTP outcome, including a replayable domain failure."""

    status_code: int
    body: dict[str, Any]
    error: ApiError | None = None
    replay: bool = False


def _actor_uuid(actor: ActorContext) -> UUID:
    try:
        return UUID(str(actor.id))
    except (TypeError, ValueError) as exc:  # pragma: no cover - defensive boundary for overrides
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.") from exc


def _patient_uuid(actor: ActorContext) -> UUID:
    value = actor.patient_id or (actor.id if actor.role == "patient" else "")
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ApiError(403, "FORBIDDEN", "Access is forbidden.") from exc


def _error_snapshot(error: ApiError) -> dict[str, Any]:
    body = ErrorBody(
        code=error.code,
        message=error.message,
        fields=error.fields,
        retryable=error.retryable,
        details=error.details,
    )
    return {"_error": body.model_dump(mode="json"), "status_code": error.status_code}


def _error_from_snapshot(snapshot: dict[str, Any]) -> ApiError:
    body = dict(snapshot.get("_error", {}))
    return ApiError(
        int(snapshot.get("status_code", 500)),
        str(body.get("code", "INTERNAL_ERROR")),
        str(body.get("message", "An unexpected error occurred.")),
        retryable=bool(body.get("retryable", False)),
        details=body.get("details"),
    )


def _validate_key(key: str | None) -> str:
    if (
        key is None
        or not 16 <= len(key) <= 128
        or any(ord(char) < 0x21 or ord(char) > 0x7E for char in key)
    ):
        raise ApiError(400, "INVALID_REQUEST", "A valid Idempotency-Key header is required.")
    return key


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ApiError(422, "VALIDATION_FAILED", "Request validation failed.")
    return value.astimezone(UTC)


async def _now(session: AsyncSession) -> datetime:
    value = await session.scalar(select(func.clock_timestamp()))
    if not isinstance(value, datetime):  # pragma: no cover - PostgreSQL always returns datetime
        raise RuntimeError("database clock did not return a timestamp")
    return value.astimezone(UTC)


class BookingService:
    """Domain logic for advisory availability and the hold/appointment lifecycle."""

    def __init__(
        self, session: AsyncSession, settings: Settings, request_id: str | None = None
    ) -> None:
        self.session = session
        self.settings = settings
        self.request_id = request_id

    async def _idempotency(
        self,
        actor: ActorContext,
        *,
        method: str,
        route_template: str,
        idempotency_key: str | None,
        fingerprint_data: dict[str, Any],
    ) -> tuple[IdempotencyRecord, ServiceResult | None]:
        key = _validate_key(idempotency_key)
        record = await reserve_idempotency(
            self.session,
            actor_id=_actor_uuid(actor),
            method=method,
            route_template=route_template,
            idempotency_key=key,
            fingerprint=request_fingerprint(fingerprint_data),
        )
        if record.status_code is None or record.response_body is None:
            return record, None
        body = dict(record.response_body)
        if "_error" in body:
            error = _error_from_snapshot(body)
            return record, ServiceResult(error.status_code, {}, error=error, replay=True)
        return record, ServiceResult(int(record.status_code), body, replay=True)

    @staticmethod
    def _complete_idempotency(
        record: IdempotencyRecord, result: ServiceResult, now: datetime
    ) -> None:
        record.status_code = result.status_code
        record.response_body = _error_snapshot(result.error) if result.error else result.body
        record.completed_at = now

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
        """Run an operation in one transaction and persist its first outcome."""

        async with self.session.begin():
            record, replay = await self._idempotency(
                actor,
                method=method,
                route_template=route_template,
                idempotency_key=idempotency_key,
                fingerprint_data=fingerprint_data,
            )
            if replay is not None:
                return replay
            try:
                result = await operation(record)
            except ApiError as error:
                now = await _now(self.session)
                result = ServiceResult(error.status_code, {}, error=error)
                self._complete_idempotency(record, result, now)
                return result
            now = await _now(self.session)
            self._complete_idempotency(record, result, now)
            return result

    async def create_hold(
        self, actor: ActorContext, request: Any, idempotency_key: str | None
    ) -> ServiceResult:
        starts_at = _ensure_utc(request.starts_at)
        ends_at = starts_at + timedelta(minutes=request.duration_minutes)
        doctor_id = UUID(str(request.doctor_id))

        async def operation(record: IdempotencyRecord) -> ServiceResult:
            await lock_doctor_booking_lane(self.session, doctor_id)
            now = await _now(self.session)
            await expire_active_holds(self.session, now=now, doctor_id=doctor_id)
            doctor = await get_doctor_for_booking(self.session, doctor_id)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            self._validate_duration(doctor, request.duration_minutes)
            await self._validate_schedule(doctor, starts_at, ends_at)
            if await list_active_appointments(
                self.session, doctor_id=doctor_id, starts_at=starts_at, ends_at=ends_at
            ):
                raise ApiError(
                    409,
                    "SLOT_CONFLICT",
                    "The selected time is no longer available.",
                    details={"doctor_id": str(doctor_id)},
                )
            if await list_active_holds(
                self.session, doctor_id=doctor_id, starts_at=starts_at, ends_at=ends_at, now=now
            ):
                raise ApiError(
                    409,
                    "SLOT_CONFLICT",
                    "The selected time is no longer available.",
                    details={"doctor_id": str(doctor_id)},
                )
            hold = SlotHold(
                patient_id=_patient_uuid(actor),
                doctor_id=doctor_id,
                starts_at=starts_at,
                ends_at=ends_at,
                expires_at=now + timedelta(seconds=self.settings.hold_ttl_seconds),
            )
            try:
                async with self.session.begin_nested():
                    self.session.add(hold)
                    await self.session.flush()
            except IntegrityError as exc:
                conflict = _slot_conflict_from_integrity(exc, doctor_id)
                if conflict is not None:
                    raise conflict from exc
                raise
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="hold.created",
                resource_type="hold",
                resource_id=hold.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(201, dump_hold(hold))

        return await self._run_idempotent(
            actor,
            method="POST",
            route_template="POST /holds",
            idempotency_key=idempotency_key,
            fingerprint_data={
                "doctor_id": str(request.doctor_id),
                "starts_at": starts_at.isoformat(),
                "duration_minutes": request.duration_minutes,
            },
            operation=operation,
        )

    async def get_hold(self, actor: ActorContext, hold_id: UUID) -> SlotHold:
        patient_id = _patient_uuid(actor)
        async with self.session.begin():
            initial = await self.session.scalar(select(SlotHold).where(SlotHold.id == hold_id))
            if initial is None or initial.patient_id != patient_id:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            await lock_doctor_booking_lane(self.session, initial.doctor_id)
            now = await _now(self.session)
            result = await self.session.execute(
                query_owned_hold(hold_id, patient_id).with_for_update()
            )
            hold = result.scalar_one_or_none()
            if hold is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if hold.status == "active" and hold.expires_at <= now:
                hold.status = "expired"
                hold.version += 1
                hold.updated_at = now
            return hold

    async def release_hold(
        self, actor: ActorContext, hold_id: UUID, idempotency_key: str | None
    ) -> ServiceResult:
        async def operation(record: IdempotencyRecord) -> ServiceResult:
            patient_id = _patient_uuid(actor)
            initial = await self.session.scalar(select(SlotHold).where(SlotHold.id == hold_id))
            if initial is None or initial.patient_id != patient_id:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            await lock_doctor_booking_lane(self.session, initial.doctor_id)
            now = await _now(self.session)
            result = await self.session.execute(
                query_owned_hold(hold_id, patient_id).with_for_update()
            )
            hold = result.scalar_one_or_none()
            if hold is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            if hold.status == "active":
                if hold.expires_at <= now:
                    hold.status = "expired"
                else:
                    hold.status = "released"
                hold.version += 1
                hold.updated_at = now
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="hold.released",
                resource_type="hold",
                resource_id=hold.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(204, {})

        return await self._run_idempotent(
            actor,
            method="DELETE",
            route_template="DELETE /holds/{hold_id}",
            idempotency_key=idempotency_key,
            fingerprint_data={"hold_id": str(hold_id)},
            operation=operation,
        )

    async def confirm_hold(
        self, actor: ActorContext, hold_id: UUID, request: Any, idempotency_key: str | None
    ) -> ServiceResult:
        symptoms_text = request.symptoms_text

        async def operation(record: IdempotencyRecord) -> ServiceResult:
            patient_id = _patient_uuid(actor)
            initial = await self.session.scalar(select(SlotHold).where(SlotHold.id == hold_id))
            if initial is None or initial.patient_id != patient_id:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            await lock_doctor_booking_lane(self.session, initial.doctor_id)
            now = await _now(self.session)
            result = await self.session.execute(
                select(SlotHold).where(SlotHold.id == hold_id).with_for_update()
            )
            hold = result.scalar_one_or_none()
            if hold is None or hold.patient_id != patient_id:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            await expire_active_holds(self.session, now=now, doctor_id=hold.doctor_id)
            if hold.status == "active" and hold.expires_at <= now:
                hold.status = "expired"
                hold.version += 1
                hold.updated_at = now
                raise ApiError(409, "HOLD_EXPIRED", "The selected hold has expired.")
            if hold.status == "expired":
                raise ApiError(409, "HOLD_EXPIRED", "The selected hold has expired.")
            if hold.status != "active":
                raise ApiError(
                    409,
                    "INVALID_STATE_TRANSITION",
                    "The hold cannot be confirmed in its current state.",
                )
            doctor = await get_doctor_for_booking(self.session, hold.doctor_id)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            await self._validate_schedule(doctor, hold.starts_at, hold.ends_at)
            if await list_active_appointments(
                self.session,
                doctor_id=hold.doctor_id,
                starts_at=hold.starts_at,
                ends_at=hold.ends_at,
            ):
                raise ApiError(
                    409,
                    "SLOT_CONFLICT",
                    "The selected time is no longer available.",
                    details={"doctor_id": str(hold.doctor_id)},
                )
            appointment = Appointment(
                patient_id=hold.patient_id,
                doctor_id=hold.doctor_id,
                starts_at=hold.starts_at,
                ends_at=hold.ends_at,
                symptoms_text=symptoms_text,
                status="confirmed",
            )
            try:
                async with self.session.begin_nested():
                    self.session.add(appointment)
                    await self.session.flush()
            except IntegrityError as exc:
                conflict = _slot_conflict_from_integrity(exc, hold.doctor_id)
                if conflict is not None:
                    raise conflict from exc
                raise
            symptom = SymptomVersion(
                appointment_id=appointment.id,
                version=1,
                symptoms_text=symptoms_text,
                created_by_actor_id=_actor_uuid(actor),
            )
            self.session.add(symptom)
            await self.session.flush()
            pre_visit_artifact = GeneratedArtifact(
                appointment_id=appointment.id,
                artifact_type="pre_visit_brief",
                status="pending",
                source_record_type="symptom_version",
                source_record_id=symptom.id,
                source_versions={"symptom_version": 1},
                task_version="v1",
            )
            self.session.add(pre_visit_artifact)
            await self.session.flush()
            hold.status = "converted"
            hold.version += 1
            hold.updated_at = now
            notification_event = await add_outbox_event(
                self.session,
                event_type="email.notification",
                aggregate_type="appointment",
                aggregate_id=appointment.id,
                appointment_id=appointment.id,
                dedupe_key=f"appointment-confirmed:{appointment.id}",
                payload={
                    "appointment_id": str(appointment.id),
                    "template_key": "appointment_confirmed",
                    "recipient_reference": str(appointment.patient_id),
                },
                correlation_id=self.request_id,
            )
            self.session.add(
                IntegrationOperation(
                    appointment_id=appointment.id,
                    outbox_event_id=notification_event.id,
                    channel="email",
                    state="pending",
                )
            )
            calendar_event = await add_outbox_event(
                self.session,
                event_type="calendar.sync",
                aggregate_type="appointment",
                aggregate_id=appointment.id,
                appointment_id=appointment.id,
                dedupe_key=f"appointment-calendar:{appointment.id}",
                payload={
                    "appointment_id": str(appointment.id),
                    "starts_at": appointment.starts_at.isoformat(),
                    "ends_at": appointment.ends_at.isoformat(),
                    "time_zone": "UTC",
                    "event_label": "Healthcare appointment",
                },
                correlation_id=self.request_id,
            )
            self.session.add(
                IntegrationOperation(
                    appointment_id=appointment.id,
                    outbox_event_id=calendar_event.id,
                    channel="calendar",
                    state="pending",
                )
            )
            llm_event = await add_outbox_event(
                self.session,
                event_type="llm.summary",
                aggregate_type="appointment",
                aggregate_id=appointment.id,
                appointment_id=appointment.id,
                dedupe_key=f"appointment-pre-visit-brief:{appointment.id}",
                payload={
                    "source_record_reference": str(symptom.id),
                    "source_version": 1,
                    "task_kind": "pre_visit",
                },
                correlation_id=self.request_id,
            )
            self.session.add(
                IntegrationOperation(
                    appointment_id=appointment.id,
                    outbox_event_id=llm_event.id,
                    channel="llm",
                    state="pending",
                )
            )
            await add_audit_event(
                self.session,
                actor_id=_actor_uuid(actor),
                action="appointment.confirmed",
                resource_type="appointment",
                resource_id=appointment.id,
                request_id=self.request_id,
                outcome="succeeded",
            )
            return ServiceResult(201, dump_appointment(appointment))

        return await self._run_idempotent(
            actor,
            method="POST",
            route_template="POST /holds/{hold_id}/confirm",
            idempotency_key=idempotency_key,
            fingerprint_data={"hold_id": str(hold_id), "symptoms_text": symptoms_text},
            operation=operation,
        )

    async def availability(
        self, doctor_id: UUID, starts_at: datetime, ends_at: datetime, duration_minutes: int
    ) -> list[dict[str, Any]]:
        starts_at = _ensure_utc(starts_at)
        ends_at = _ensure_utc(ends_at)
        if starts_at >= ends_at:
            raise ApiError(422, "VALIDATION_FAILED", "Request validation failed.")
        if ends_at - starts_at > timedelta(days=31):
            raise ApiError(422, "VALIDATION_FAILED", "The availability range is too large.")
        async with self.session.begin():
            now = await _now(self.session)
            await expire_active_holds(self.session, now=now, doctor_id=doctor_id)
            doctor = await get_doctor_for_booking(self.session, doctor_id)
            if doctor is None:
                raise ApiError(404, "RESOURCE_NOT_FOUND", "The requested resource was not found.")
            self._validate_duration(doctor, duration_minutes)
            zone = self._zone(doctor)
            local_date = starts_at.astimezone(zone).date()
            final_date = ends_at.astimezone(zone).date()
            candidates: list[tuple[datetime, datetime]] = []
            cursor = local_date
            while cursor <= final_date:
                for hours in doctor.working_hours:
                    if hours.weekday != cursor.weekday():
                        continue
                    local_start = datetime.combine(cursor, hours.starts_local, tzinfo=zone)
                    local_end = datetime.combine(cursor, hours.ends_local, tzinfo=zone)
                    candidate = local_start
                    while candidate + timedelta(minutes=duration_minutes) <= local_end:
                        candidate_end = candidate + timedelta(minutes=duration_minutes)
                        slot_start = candidate.astimezone(UTC)
                        slot_end = candidate_end.astimezone(UTC)
                        if slot_start >= starts_at and slot_end <= ends_at:
                            candidates.append((slot_start, slot_end))
                        candidate = candidate_end
                cursor += timedelta(days=1)
            blockers = await list_availability_blockers(
                self.session,
                doctor_id=doctor_id,
                starts_at=starts_at,
                ends_at=ends_at,
                now=now,
            )
            slots = [
                {
                    "doctor_id": doctor_id,
                    "starts_at": slot_start,
                    "ends_at": slot_end,
                    "available": not any(
                        blocker_start < slot_end and blocker_end > slot_start
                        for _, blocker_start, blocker_end in blockers
                    ),
                }
                for slot_start, slot_end in candidates
            ]
            slots.sort(key=lambda item: cast(datetime, item["starts_at"]))
            return slots

    @staticmethod
    def _validate_duration(doctor: Doctor, duration_minutes: int) -> None:
        durations = doctor.appointment_durations_minutes or []
        if duration_minutes not in durations:
            raise ApiError(
                422,
                "VALIDATION_FAILED",
                "The requested duration is not configured for this doctor.",
                details={"duration_minutes": duration_minutes},
            )

    @staticmethod
    def _zone(doctor: Doctor) -> ZoneInfo:
        try:
            return ZoneInfo(doctor.timezone)
        except ZoneInfoNotFoundError as exc:
            raise ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred.") from exc

    async def _validate_schedule(
        self, doctor: Doctor, starts_at: datetime, ends_at: datetime
    ) -> None:
        zone = self._zone(doctor)
        local_start = starts_at.astimezone(zone)
        local_end = ends_at.astimezone(zone)
        matches = [
            item
            for item in doctor.working_hours
            if item.weekday == local_start.weekday()
            and local_start.date() == local_end.date()
            and local_start.timetz().replace(tzinfo=None) >= item.starts_local
            and local_end.timetz().replace(tzinfo=None) <= item.ends_local
        ]
        if not matches:
            raise ApiError(
                409,
                "SLOT_CONFLICT",
                "The selected time is outside the doctor's working hours.",
            )
        if await list_leave_overlaps(
            self.session,
            doctor_id=doctor.id,
            starts_at=starts_at,
            ends_at=ends_at,
        ):
            raise ApiError(
                409,
                "SLOT_CONFLICT",
                "The selected time is not available.",
            )
