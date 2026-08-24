"""Small persistence boundary used by booking services."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, literal, select, union_all, update
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

_SAFE_PAYLOAD_KEY_PARTS = (
    "symptom",
    "note",
    "diagnos",
    "prescription",
    "clinical",
    "email",
    "phone",
    "address",
    "token",
    "secret",
    "prompt",
    "response",
    "content",
    "body",
    "_text",
)


def _assert_reference_payload(value: Any, *, path: str = "payload") -> None:
    """Reject PHI/secrets before they can enter a durable outbox row."""

    if isinstance(value, Mapping):
        for raw_key, child in value.items():
            key = re.sub(r"[^a-z0-9_]+", "_", str(raw_key).casefold()).strip("_")
            if key.endswith(("_id", "_uuid", "_ref", "_reference")):
                if isinstance(child, str) and "@" in child:
                    raise ValueError(f"outbox payload field at {path}.{raw_key} is not allowed")
            elif key.endswith("_name") or any(part in key for part in _SAFE_PAYLOAD_KEY_PARTS):
                raise ValueError(f"outbox payload field at {path}.{raw_key} is not allowed")
            _assert_reference_payload(child, path=f"{path}.{raw_key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _assert_reference_payload(child, path=f"{path}[{index}]")


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


async def list_availability_blockers(
    session: AsyncSession,
    *,
    doctor_id: UUID,
    starts_at: datetime,
    ends_at: datetime,
    now: datetime,
) -> list[tuple[str, datetime, datetime]]:
    """Fetch all blockers for an availability window in one set-oriented query.

    Availability generation may produce many candidate slots.  The old implementation
    executed three queries for every candidate; this query returns the union of all
    relevant leave, hold, and appointment ranges once, after which the service performs
    cheap in-memory interval checks.
    """

    leave_query = select(
        literal("leave").label("kind"),
        DoctorLeave.starts_at.label("starts_at"),
        DoctorLeave.ends_at.label("ends_at"),
    ).where(
        DoctorLeave.doctor_id == doctor_id,
        DoctorLeave.is_active.is_(True),
        DoctorLeave.starts_at < ends_at,
        DoctorLeave.ends_at > starts_at,
    )
    hold_query = select(
        literal("hold").label("kind"),
        SlotHold.starts_at.label("starts_at"),
        SlotHold.ends_at.label("ends_at"),
    ).where(
        SlotHold.doctor_id == doctor_id,
        SlotHold.status == "active",
        SlotHold.expires_at > now,
        SlotHold.starts_at < ends_at,
        SlotHold.ends_at > starts_at,
    )
    appointment_query = select(
        literal("appointment").label("kind"),
        Appointment.starts_at.label("starts_at"),
        Appointment.ends_at.label("ends_at"),
    ).where(
        Appointment.doctor_id == doctor_id,
        Appointment.status.in_(("confirmed", "in_progress")),
        Appointment.starts_at < ends_at,
        Appointment.ends_at > starts_at,
    )
    statement = union_all(leave_query, hold_query, appointment_query)
    result = await session.execute(statement)
    return [(str(row.kind), row.starts_at, row.ends_at) for row in result]


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
    correlation_id: str | None = None,
    version: int = 1,
) -> OutboxEvent:
    """Persist a worker-compatible, reference-only outbox row.

    The worker validates an EventEnvelope.  Keeping the event UUID, correlation ID,
    and schema version as first-class columns lets a dispatcher construct that
    envelope without copying PHI into the payload.
    """

    _assert_reference_payload(payload)

    event = OutboxEvent(
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        appointment_id=appointment_id,
        dedupe_key=dedupe_key,
        payload=payload,
        correlation_id=correlation_id or "system",
        version=version,
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
