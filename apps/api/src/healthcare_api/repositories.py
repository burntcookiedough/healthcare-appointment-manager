"""Small persistence boundary used by booking services."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Appointment,
    AuditEvent,
    Doctor,
    DoctorLeave,
    IdempotencyRecord,
    OutboxEvent,
    SlotHold,
)


def request_fingerprint(value: Mapping[str, Any]) -> str:
    """Hash canonical request data; callers never put PHI in the idempotency key."""

    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def reserve_idempotency(
    session: AsyncSession,
    *,
    actor_id: UUID,
    method: str,
    route_template: str,
    idempotency_key: str,
    fingerprint: str,
) -> IdempotencyRecord:
    """Insert-or-lock an idempotency row, serializing concurrent key uses."""

    statement = (
        pg_insert(IdempotencyRecord)
        .values(
            actor_id=actor_id,
            method=method,
            route_template=route_template,
            idempotency_key=idempotency_key,
            request_fingerprint=fingerprint,
        )
        .on_conflict_do_nothing(
            index_elements=["actor_id", "method", "route_template", "idempotency_key"]
        )
    )
    await session.execute(statement)
    result = await session.execute(
        select(IdempotencyRecord)
        .where(
            IdempotencyRecord.actor_id == actor_id,
            IdempotencyRecord.method == method,
            IdempotencyRecord.route_template == route_template,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
        .with_for_update()
    )
    record = result.scalar_one()
    if record.request_fingerprint != fingerprint:
        from .errors import ApiError

        raise ApiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "The idempotency key was already used for a different request.",
        )
    return record


async def get_doctor_for_booking(session: AsyncSession, doctor_id: UUID) -> Doctor | None:
    """Load a doctor and its schedule using explicit queries (no implicit lazy IO)."""

    from sqlalchemy.orm import selectinload

    doctor_result = await session.execute(
        select(Doctor)
        .options(selectinload(Doctor.working_hours))
        .where(Doctor.id == doctor_id, Doctor.is_active.is_(True))
    )
    doctor = doctor_result.scalar_one_or_none()
    return doctor


async def lock_doctor_booking_lane(session: AsyncSession, doctor_id: UUID) -> None:
    """Serialize all API booking mutations for one doctor in the current transaction.

    The per-doctor transaction advisory lock closes the cross-table race that separate
    GiST constraints cannot express (a hold versus an appointment).  The constraints
    remain the final database guard for each resource table and direct SQL writes.
    """

    await session.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(str(doctor_id), 0)))
    )


async def list_leave_overlaps(
    session: AsyncSession, *, doctor_id: UUID, starts_at: datetime, ends_at: datetime
) -> list[DoctorLeave]:
    result = await session.execute(
        select(DoctorLeave).where(
            DoctorLeave.doctor_id == doctor_id,
            DoctorLeave.is_active.is_(True),
            DoctorLeave.starts_at < ends_at,
            DoctorLeave.ends_at > starts_at,
        )
    )
    return list(result.scalars())


async def list_active_holds(
    session: AsyncSession, *, doctor_id: UUID, starts_at: datetime, ends_at: datetime, now: datetime
) -> list[SlotHold]:
    result = await session.execute(
        select(SlotHold).where(
            SlotHold.doctor_id == doctor_id,
            SlotHold.status == "active",
            SlotHold.expires_at > now,
            SlotHold.starts_at < ends_at,
            SlotHold.ends_at > starts_at,
        )
    )
    return list(result.scalars())


async def list_active_appointments(
    session: AsyncSession, *, doctor_id: UUID, starts_at: datetime, ends_at: datetime
) -> list[Appointment]:
    result = await session.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor_id,
            Appointment.status.in_(("confirmed", "in_progress")),
            Appointment.starts_at < ends_at,
            Appointment.ends_at > starts_at,
        )
    )
    return list(result.scalars())


async def expire_active_holds(
    session: AsyncSession, *, now: datetime, doctor_id: UUID | None = None
) -> None:
    """Mark expired active holds before conflict checks.

    The partial GiST exclusion constraint is status-based because PostgreSQL predicates
    cannot contain a volatile current-time expression.  This transactionally advances
    expired rows before a new hold is inserted, while concurrent inserts remain
    serialized by the exclusion constraint.
    """

    filters = [SlotHold.status == "active", SlotHold.expires_at <= now]
    if doctor_id is not None:
        filters.append(SlotHold.doctor_id == doctor_id)
    await session.execute(
        update(SlotHold)
        .where(*filters)
        .values(status="expired", version=SlotHold.version + 1, updated_at=now)
    )


async def add_outbox_event(
    session: AsyncSession,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    dedupe_key: str,
    payload: dict[str, Any],
    appointment_id: UUID | None = None,
) -> OutboxEvent:
    event = OutboxEvent(
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        appointment_id=appointment_id,
        dedupe_key=dedupe_key,
        payload=payload,
    )
    session.add(event)
    await session.flush()
    return event


async def add_audit_event(
    session: AsyncSession,
    *,
    actor_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | None,
    request_id: str | None,
    outcome: str,
    reason: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        request_id=request_id,
        outcome=outcome,
        reason=reason,
    )
    session.add(event)
    await session.flush()
    return event


def query_owned_hold(hold_id: UUID, patient_id: UUID) -> Select[tuple[SlotHold]]:
    return select(SlotHold).where(SlotHold.id == hold_id, SlotHold.patient_id == patient_id)
