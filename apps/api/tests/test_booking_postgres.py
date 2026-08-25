"""PostgreSQL integration and concurrency evidence for booking invariants."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from healthcare_api.auth import ActorContext
from healthcare_api.booking import BookingService, _slot_conflict_from_integrity
from healthcare_api.config import Settings
from healthcare_api.errors import ApiError
from healthcare_api.models import (
    Actor,
    Appointment,
    Doctor,
    DoctorWorkingHour,
    OutboxEvent,
    PatientProfile,
    SlotHold,
)
from healthcare_api.schemas import HoldConfirmRequest, HoldCreateRequest

TEST_DATABASE_URL = os.getenv("HEALTHCARE_TEST_DATABASE_URL") or os.getenv("TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not TEST_DATABASE_URL,
        reason="set HEALTHCARE_TEST_DATABASE_URL to run PostgreSQL integration tests",
    ),
]
API_ROOT = Path(__file__).resolve().parents[1]


def _async_url(url: str) -> str:
    if url.startswith("postgresql+asyncpg://"):
        return url
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest_asyncio.fixture
async def database_engine() -> AsyncEngine:
    assert TEST_DATABASE_URL is not None
    active_engine = create_async_engine(_async_url(TEST_DATABASE_URL), pool_pre_ping=True)
    async with active_engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.execute(text("GRANT ALL ON SCHEMA public TO healthcare"))
    environment = os.environ.copy()
    environment["DATABASE_URL"] = _async_url(TEST_DATABASE_URL)
    await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    yield active_engine
    async with active_engine.begin() as connection:
        await connection.execute(text("DROP SCHEMA public CASCADE"))
        await connection.execute(text("CREATE SCHEMA public"))
        await connection.execute(text("GRANT ALL ON SCHEMA public TO healthcare"))
    await active_engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_database(database_engine: AsyncEngine):
    async with database_engine.begin() as connection:
        await connection.execute(
            text(
                "TRUNCATE integration_operations, reminder_occurrences, reminder_preferences, "
                "prescription_items, prescriptions, generated_artifacts, visit_note_versions, "
                "visits, symptom_versions, appointment_history, leave_previews, audit_events, "
                "outbox_events, idempotency_records, appointments, slot_holds, doctor_leave, "
                "doctor_working_hours, doctors, patient_profiles, actors CASCADE"
            )
        )
    yield


@pytest_asyncio.fixture
async def session_factory(database_engine: AsyncEngine):
    return async_sessionmaker(database_engine, expire_on_commit=False, class_=AsyncSession)


async def seed_doctor(
    session_factory: async_sessionmaker[AsyncSession], *, patient_count: int = 1
) -> tuple[UUID, list[ActorContext], Settings, datetime]:
    doctor_actor_id = uuid4()
    doctor_id = uuid4()
    patient_contexts: list[ActorContext] = []
    async with session_factory() as session:
        async with session.begin():
            session.add(
                Actor(id=doctor_actor_id, subject_id=f"doctor-{doctor_actor_id}", role="doctor")
            )
            doctor = Doctor(
                id=doctor_id,
                actor_id=doctor_actor_id,
                display_name="Synthetic Doctor",
                timezone="UTC",
                appointment_durations_minutes=[30],
            )
            session.add(doctor)
            session.add(
                DoctorWorkingHour(
                    doctor_id=doctor_id,
                    weekday=0,
                    starts_local=time(9, 0),
                    ends_local=time(17, 0),
                )
            )
            for _ in range(patient_count):
                actor_id = uuid4()
                session.add(Actor(id=actor_id, subject_id=f"patient-{actor_id}", role="patient"))
                session.add(PatientProfile(actor_id=actor_id, display_name="Synthetic Patient"))
                patient_contexts.append(
                    ActorContext(
                        id=str(actor_id),
                        subject_id=f"patient-{actor_id}",
                        role="patient",
                        patient_id=str(actor_id),
                    )
                )
    return (
        doctor_id,
        patient_contexts,
        Settings(database_url=_async_url(TEST_DATABASE_URL or ""), hold_ttl_seconds=120),
        datetime(2026, 8, 24, 10, 0, tzinfo=UTC),
    )


@pytest.mark.asyncio
async def test_concurrent_hold_contenders_have_exactly_one_winner(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory, patient_count=20)
    release = asyncio.Event()

    async def contender(actor: ActorContext, index: int):
        await release.wait()
        async with session_factory() as session:
            service = BookingService(session, settings, request_id=f"concurrency-{index}")
            return await service.create_hold(
                actor,
                HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
                f"concurrent-hold-key-{index:04d}",
            )

    tasks = [asyncio.create_task(contender(actor, index)) for index, actor in enumerate(actors)]
    release.set()
    outcomes = await asyncio.gather(*tasks)

    assert sum(result.error is None for result in outcomes) == 1
    assert (
        sum(
            result.error is not None and result.error.code == "SLOT_CONFLICT" for result in outcomes
        )
        == 19
    )
    async with session_factory() as session:
        count = await session.scalar(
            select(func.count(SlotHold.id)).where(
                SlotHold.doctor_id == doctor_id,
                SlotHold.status == "active",
            )
        )
    assert count == 1


@pytest.mark.asyncio
async def test_availability_reports_booking_conflict_reason(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory)
    async with session_factory() as session:
        created = await BookingService(session, settings).create_hold(
            actors[0],
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            "availability-hold-key",
        )
        assert created.error is None

    async with session_factory() as session:
        slots = await BookingService(session, settings).availability(
            doctor_id,
            starts_at,
            starts_at + timedelta(hours=1),
            30,
        )

    assert slots[0]["available"] is False
    assert slots[0]["conflict_reason"] == "Slot booked"
    assert slots[1]["available"] is True
    assert slots[1]["conflict_reason"] is None


@pytest.mark.asyncio
async def test_asyncpg_exclusion_violation_maps_to_slot_conflict(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory)
    async with session_factory() as session:
        created = await BookingService(session, settings).create_hold(
            actors[0],
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            "constraint-first-hold-key",
        )
        assert created.error is None

    async with session_factory() as session:
        with pytest.raises(IntegrityError) as raised:
            async with session.begin():
                session.add(
                    SlotHold(
                        patient_id=UUID(actors[0].id),
                        doctor_id=doctor_id,
                        starts_at=starts_at,
                        ends_at=starts_at + timedelta(minutes=30),
                        expires_at=starts_at + timedelta(hours=1),
                    )
                )
                await session.flush()

    conflict = _slot_conflict_from_integrity(raised.value, doctor_id)
    assert conflict is not None
    assert conflict.status_code == 409
    assert conflict.code == "SLOT_CONFLICT"


@pytest.mark.asyncio
async def test_expired_hold_cannot_confirm_and_creates_no_booking_work(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory)
    actor = actors[0]
    async with session_factory() as session:
        service = BookingService(session, settings, request_id="expired-create")
        created = await service.create_hold(
            actor,
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            "expired-hold-create-key",
        )
        hold_id = UUID(str(created.body["id"]))
    async with session_factory() as session:
        await session.execute(
            update(SlotHold)
            .where(SlotHold.id == hold_id)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
        result = await BookingService(session, settings, request_id="expired-confirm").confirm_hold(
            actor,
            hold_id,
            HoldConfirmRequest(symptoms_text="synthetic symptom"),
            "expired-hold-confirm-key",
        )
        assert result.error is not None
        assert result.error.code == "HOLD_EXPIRED"
        assert await session.scalar(select(func.count(Appointment.id))) == 0
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 0


@pytest.mark.asyncio
async def test_wrong_owner_cannot_read_or_confirm_hold(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory, patient_count=2)
    owner, other = actors
    async with session_factory() as session:
        created = await BookingService(session, settings).create_hold(
            owner,
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            "owner-hold-create-key",
        )
        hold_id = UUID(str(created.body["id"]))
    async with session_factory() as session:
        with pytest.raises(ApiError) as raised:
            await BookingService(session, settings).get_hold(other, hold_id)
        assert raised.value.status_code == 404
        result = await BookingService(session, settings).confirm_hold(
            other,
            hold_id,
            HoldConfirmRequest(symptoms_text="not owner"),
            "other-confirm-key",
        )
        assert result.error is not None
        assert result.error.status_code == 404


@pytest.mark.asyncio
async def test_hold_creation_replays_same_idempotent_result(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory)
    request = HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30)
    async with session_factory() as session:
        first = await BookingService(session, settings).create_hold(
            actors[0], request, "replay-hold-key-1234"
        )
    async with session_factory() as session:
        second = await BookingService(session, settings).create_hold(
            actors[0], request, "replay-hold-key-1234"
        )
    assert first.status_code == second.status_code == 201
    assert first.body == second.body
    assert second.replay is True


@pytest.mark.asyncio
async def test_confirmation_failure_rolls_back_appointment_and_hold_conversion(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doctor_id, actors, settings, starts_at = await seed_doctor(session_factory)
    async with session_factory() as session:
        created = await BookingService(session, settings).create_hold(
            actors[0],
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            "atomic-hold-create-key",
        )
        hold_id = UUID(str(created.body["id"]))

    async def fail_outbox(*args, **kwargs):
        raise RuntimeError("synthetic outbox failure")

    monkeypatch.setattr("healthcare_api.booking.add_outbox_event", fail_outbox)
    async with session_factory() as session:
        with pytest.raises(RuntimeError, match="synthetic outbox failure"):
            await BookingService(session, settings).confirm_hold(
                actors[0],
                hold_id,
                HoldConfirmRequest(symptoms_text="original synthetic symptom"),
                "atomic-confirm-key",
            )
    async with session_factory() as session:
        hold = await session.scalar(select(SlotHold).where(SlotHold.id == hold_id))
        assert hold is not None and hold.status == "active"
        assert await session.scalar(select(func.count(Appointment.id))) == 0
        assert await session.scalar(select(func.count(OutboxEvent.id))) == 0
