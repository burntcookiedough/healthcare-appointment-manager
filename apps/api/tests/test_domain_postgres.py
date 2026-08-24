"""Migrated PostgreSQL behavior checks for the application domain API."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, time
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from healthcare_api.auth import ActorContext
from healthcare_api.booking import BookingService
from healthcare_api.config import Settings, get_settings
from healthcare_api.db import get_session
from healthcare_api.domain import DomainService
from healthcare_api.domain_schemas import LeaveApplyRequest
from healthcare_api.main import app
from healthcare_api.models import (
    Actor,
    Appointment,
    Doctor,
    DoctorLeave,
    DoctorWorkingHour,
    GeneratedArtifact,
    IntegrationOperation,
    OutboxEvent,
    PatientProfile,
    Prescription,
    PrescriptionItem,
    SlotHold,
    SymptomVersion,
    Visit,
    VisitNoteVersion,
)
from healthcare_api.schemas import HoldConfirmRequest, HoldCreateRequest

TEST_DATABASE_URL = os.getenv("HEALTHCARE_TEST_DATABASE_URL") or os.getenv("TEST_DATABASE_URL")
API_ROOT = Path(__file__).resolve().parents[1]
JWT_SECRET = "domain-test-secret"
JWT_ISSUER = "https://synthetic.supabase.co/auth/v1"
JWT_AUDIENCE = "authenticated"
TEST_NOW = datetime(2026, 8, 24, 9, 0, tzinfo=UTC)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not TEST_DATABASE_URL,
        reason="set HEALTHCARE_TEST_DATABASE_URL to run PostgreSQL integration tests",
    ),
]


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
async def clean_database(database_engine: AsyncEngine) -> AsyncIterator[None]:
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
async def session_factory(
    database_engine: AsyncEngine,
) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(database_engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def api_client(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[httpx.AsyncClient]:
    assert TEST_DATABASE_URL is not None
    monkeypatch.setenv("DATABASE_URL", _async_url(TEST_DATABASE_URL))
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("AUTH_ALLOW_LOCAL_TEST_TOKENS", "false")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", JWT_ISSUER)
    monkeypatch.setenv("SUPABASE_JWT_AUDIENCE", JWT_AUDIENCE)
    get_settings.cache_clear()

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()


@dataclass(frozen=True)
class Seed:
    admin: ActorContext
    doctor_a: ActorContext
    doctor_b: ActorContext
    doctor_a_id: UUID
    doctor_b_id: UUID
    candidate_subject: str
    patients: tuple[ActorContext, ...]


async def seed_domain(
    session_factory: async_sessionmaker[AsyncSession], *, patient_count: int = 3
) -> Seed:
    admin_id = uuid4()
    doctor_a_actor_id = uuid4()
    doctor_b_actor_id = uuid4()
    doctor_a_id = uuid4()
    doctor_b_id = uuid4()
    candidate_actor_id = uuid4()
    candidate_subject = f"candidate-doctor-{candidate_actor_id}"
    patient_ids = [uuid4() for _ in range(patient_count)]
    patient_subjects = [f"patient-{patient_id}" for patient_id in patient_ids]

    async with session_factory() as session:
        async with session.begin():
            session.add_all(
                [
                    Actor(id=admin_id, subject_id="admin-domain", role="admin"),
                    Actor(id=doctor_a_actor_id, subject_id="doctor-a-domain", role="doctor"),
                    Actor(id=doctor_b_actor_id, subject_id="doctor-b-domain", role="doctor"),
                    Actor(id=candidate_actor_id, subject_id=candidate_subject, role="doctor"),
                    Doctor(
                        id=doctor_a_id,
                        actor_id=doctor_a_actor_id,
                        display_name="Doctor A",
                        specialization="Cardiology",
                        timezone="UTC",
                        appointment_durations_minutes=[30, 60],
                    ),
                    Doctor(
                        id=doctor_b_id,
                        actor_id=doctor_b_actor_id,
                        display_name="Doctor B",
                        specialization="Dermatology",
                        timezone="UTC",
                        appointment_durations_minutes=[30],
                    ),
                    DoctorWorkingHour(
                        doctor_id=doctor_a_id,
                        weekday=0,
                        starts_local=time(9, 0),
                        ends_local=time(17, 0),
                    ),
                    DoctorWorkingHour(
                        doctor_id=doctor_b_id,
                        weekday=0,
                        starts_local=time(9, 0),
                        ends_local=time(17, 0),
                    ),
                ]
            )
            for patient_id in patient_ids:
                session.add(
                    Actor(
                        id=patient_id,
                        subject_id=f"patient-{patient_id}",
                        role="patient",
                    )
                )
                session.add(
                    PatientProfile(actor_id=patient_id, display_name=f"Patient {patient_id}")
                )

    patients = tuple(
        ActorContext(
            id=str(patient_id),
            subject_id=subject,
            role="patient",
            patient_id=str(patient_id),
        )
        for patient_id, subject in zip(patient_ids, patient_subjects, strict=True)
    )
    return Seed(
        admin=ActorContext(id=str(admin_id), subject_id="admin-domain", role="admin"),
        doctor_a=ActorContext(
            id=str(doctor_a_actor_id),
            subject_id="doctor-a-domain",
            role="doctor",
            doctor_id=str(doctor_a_id),
        ),
        doctor_b=ActorContext(
            id=str(doctor_b_actor_id),
            subject_id="doctor-b-domain",
            role="doctor",
            doctor_id=str(doctor_b_id),
        ),
        doctor_a_id=doctor_a_id,
        doctor_b_id=doctor_b_id,
        candidate_subject=candidate_subject,
        patients=patients,
    )


def _encode_segment(value: object) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _jwt(subject: str, *, secret: str = JWT_SECRET) -> str:
    header = _encode_segment({"alg": "HS256", "typ": "JWT"})
    body = _encode_segment(
        {"sub": subject, "iss": JWT_ISSUER, "aud": JWT_AUDIENCE, "exp": 4_102_444_800}
    )
    message = f"{header}.{body}".encode()
    signature = hmac.new(secret.encode(), message, hashlib.sha256).digest()
    return f"{message.decode()}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _headers(subject: str, *, key: str | None = None, secret: str = JWT_SECRET) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {_jwt(subject, secret=secret)}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _settings() -> Settings:
    assert TEST_DATABASE_URL is not None
    return Settings(database_url=_async_url(TEST_DATABASE_URL), hold_ttl_seconds=120)


async def create_hold(
    session_factory: async_sessionmaker[AsyncSession],
    patient: ActorContext,
    doctor_id: UUID,
    starts_at: datetime,
    *,
    key: str,
) -> UUID:
    async with session_factory() as session:
        result = await BookingService(session, _settings(), "domain-test").create_hold(
            patient,
            HoldCreateRequest(doctor_id=doctor_id, starts_at=starts_at, duration_minutes=30),
            key,
        )
        assert result.error is None, result.error
        return UUID(str(result.body["id"]))


async def create_appointment(
    session_factory: async_sessionmaker[AsyncSession],
    patient: ActorContext,
    doctor_id: UUID,
    starts_at: datetime,
    *,
    suffix: str,
) -> UUID:
    hold_id = await create_hold(
        session_factory, patient, doctor_id, starts_at, key=f"hold-create-{suffix}-0001"
    )
    async with session_factory() as session:
        result = await BookingService(session, _settings(), f"confirm-{suffix}").confirm_hold(
            patient,
            hold_id,
            HoldConfirmRequest(symptoms_text=f"original symptom {suffix}"),
            f"hold-confirm-{suffix}-0001",
        )
        assert result.error is None, result.error
        return UUID(str(result.body["id"]))


@pytest.mark.asyncio
async def test_real_jwt_roles_and_ownership_are_enforced(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
) -> None:
    seed = await seed_domain(session_factory)
    appointment_id = await create_appointment(
        session_factory,
        seed.patients[0],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=10),
        suffix="rbac",
    )

    own = await api_client.get(
        f"/api/v1/appointments/{appointment_id}",
        headers=_headers(seed.patients[0].subject_id),
    )
    unrelated_patient = await api_client.get(
        f"/api/v1/appointments/{appointment_id}",
        headers=_headers(seed.patients[1].subject_id),
    )
    assigned_doctor = await api_client.get(
        f"/api/v1/appointments/{appointment_id}",
        headers=_headers(seed.doctor_a.subject_id),
    )
    unrelated_doctor = await api_client.get(
        f"/api/v1/appointments/{appointment_id}",
        headers=_headers(seed.doctor_b.subject_id),
    )
    admin_view = await api_client.get(
        f"/api/v1/appointments/{appointment_id}",
        headers=_headers(seed.admin.subject_id),
    )
    bad_signature = await api_client.get(
        "/api/v1/doctors", headers=_headers(seed.patients[0].subject_id, secret="wrong-secret")
    )

    assert own.status_code == 200
    assert assigned_doctor.status_code == 200
    assert unrelated_patient.status_code == unrelated_doctor.status_code == 404
    assert admin_view.status_code == 200
    assert admin_view.json()["symptoms_text"] is None
    assert bad_signature.status_code == 401
    assert bad_signature.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"

    for subject in (seed.patients[0].subject_id, seed.doctor_b.subject_id):
        response = await api_client.get("/api/v1/admin/integrations", headers=_headers(subject))
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"
    response = await api_client.get("/api/v1/me/profile", headers=_headers(seed.admin.subject_id))
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_doctor_provisioning_discovery_and_schedule_versioning(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
) -> None:
    seed = await seed_domain(session_factory)
    admin_headers = _headers(seed.admin.subject_id, key="doctor-provision-key-0001")
    create_response = await api_client.post(
        "/api/v1/doctors",
        headers=admin_headers,
        json={
            "subject_id": seed.candidate_subject,
            "display_name": "Provisioned Doctor",
            "credentials": "MD",
            "specialization": "Neurology",
            "timezone": "UTC",
            "appointment_durations_minutes": [30, 60],
        },
    )
    replay = await api_client.post(
        "/api/v1/doctors",
        headers=admin_headers,
        json={
            "subject_id": seed.candidate_subject,
            "display_name": "Provisioned Doctor",
            "credentials": "MD",
            "specialization": "Neurology",
            "timezone": "UTC",
            "appointment_durations_minutes": [30, 60],
        },
    )
    assert create_response.status_code == 201
    assert replay.status_code == 201
    assert replay.json() == create_response.json()
    doctor_id = UUID(create_response.json()["id"])

    search = await api_client.get(
        "/api/v1/doctors",
        params={"search": "Provisioned"},
        headers=_headers(seed.patients[0].subject_id),
    )
    detail = await api_client.get(
        f"/api/v1/doctors/{doctor_id}", headers=_headers(seed.patients[0].subject_id)
    )
    assert search.status_code == detail.status_code == 200
    assert search.json()["items"][0]["id"] == str(doctor_id)

    update = await api_client.patch(
        f"/api/v1/doctors/{doctor_id}",
        headers=_headers(seed.admin.subject_id),
        json={"expected_version": 1, "display_name": "Provisioned Doctor Updated"},
    )
    assert update.status_code == 200
    assert update.json()["version"] == 2

    initial_schedule = await api_client.get(
        f"/api/v1/doctors/{doctor_id}/working-hours", headers=_headers(seed.admin.subject_id)
    )
    assert initial_schedule.status_code == 200
    assert initial_schedule.json()["version"] == 1
    replace = await api_client.put(
        f"/api/v1/doctors/{doctor_id}/working-hours",
        headers=_headers(seed.admin.subject_id),
        json={
            "expected_version": 1,
            "timezone": "UTC",
            "appointment_durations_minutes": [30],
            "intervals": [{"weekday": 0, "starts_local": "09:00", "ends_local": "17:00"}],
        },
    )
    stale = await api_client.put(
        f"/api/v1/doctors/{doctor_id}/working-hours",
        headers=_headers(seed.admin.subject_id),
        json={"expected_version": 1, "intervals": []},
    )
    assert replace.status_code == 200
    assert replace.json()["version"] == 2
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"

    forbidden = await api_client.post(
        "/api/v1/doctors",
        headers=_headers(seed.patients[0].subject_id, key="patient-doctor-key-0001"),
        json={"subject_id": seed.candidate_subject, "display_name": "Nope"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_leave_preview_apply_atomicity_and_stale_replay(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await seed_domain(session_factory)
    hold_id = await create_hold(
        session_factory,
        seed.patients[0],
        seed.doctor_a_id,
        TEST_NOW,
        key="leave-hold-create-0001",
    )
    appointment_id = await create_appointment(
        session_factory,
        seed.patients[1],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=10),
        suffix="leave",
    )
    preview = await api_client.post(
        f"/api/v1/doctors/{seed.doctor_a_id}/leave/preview",
        headers=_headers(seed.admin.subject_id),
        json={
            "starts_at": "2026-08-24T09:00:00Z",
            "ends_at": "2026-08-24T11:00:00Z",
            "reason": "synthetic leave",
        },
    )
    assert preview.status_code == 200
    preview_body = preview.json()
    assert preview_body["affected_hold_count"] == 1
    assert preview_body["affected_appointment_count"] == 1
    assert preview_body["affected_hold_ids"] == [str(hold_id)]
    assert preview_body["affected_appointment_ids"] == [str(appointment_id)]

    async with session_factory() as session:
        assert await session.scalar(select(func.count(DoctorLeave.id))) == 0
        assert (await session.get(SlotHold, hold_id)).status == "active"
        assert (await session.get(Appointment, appointment_id)).status == "confirmed"

    apply = await api_client.post(
        f"/api/v1/doctors/{seed.doctor_a_id}/leave",
        headers=_headers(seed.admin.subject_id, key="leave-apply-key-0001"),
        json={
            "preview_token": preview_body["preview_token"],
            "expected_version": preview_body["expected_schedule_version"],
            "reason": "synthetic leave",
        },
    )
    assert apply.status_code == 201

    async with session_factory() as session:
        hold = await session.get(SlotHold, hold_id)
        appointment = await session.get(Appointment, appointment_id)
        doctor = await session.get(Doctor, seed.doctor_a_id)
        leave_count = await session.scalar(select(func.count(DoctorLeave.id)))
        leave_events = list(
            (
                await session.execute(
                    select(OutboxEvent).where(
                        OutboxEvent.appointment_id == appointment_id,
                        OutboxEvent.dedupe_key.like("appointment-leave-%"),
                    )
                )
            ).scalars()
        )
    assert hold is not None and hold.status == "expired"
    assert appointment is not None and appointment.status == "cancelled_doctor_leave"
    assert doctor is not None and doctor.schedule_version == 2
    assert leave_count == 1
    assert {event.event_type for event in leave_events} == {"email.notification", "calendar.sync"}
    assert all("@" not in json.dumps(event.payload) for event in leave_events)
    assert all("symptom" not in json.dumps(event.payload).casefold() for event in leave_events)

    replay = await api_client.post(
        f"/api/v1/doctors/{seed.doctor_a_id}/leave",
        headers=_headers(seed.admin.subject_id, key="leave-apply-key-0001"),
        json={
            "preview_token": preview_body["preview_token"],
            "expected_version": preview_body["expected_schedule_version"],
            "reason": "synthetic leave",
        },
    )
    stale = await api_client.post(
        f"/api/v1/doctors/{seed.doctor_a_id}/leave",
        headers=_headers(seed.admin.subject_id, key="leave-stale-key-0001"),
        json={
            "preview_token": preview_body["preview_token"],
            "expected_version": preview_body["expected_schedule_version"],
        },
    )
    assert replay.status_code == 201
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "LEAVE_PREVIEW_STALE"
    async with session_factory() as session:
        assert await session.scalar(select(func.count(DoctorLeave.id))) == 1
        assert (await session.get(SlotHold, hold_id)).status == "expired"
        assert (await session.get(Appointment, appointment_id)).status == "cancelled_doctor_leave"

    second_appointment = await create_appointment(
        session_factory,
        seed.patients[2],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=12),
        suffix="leave-rollback",
    )
    preview_two = await api_client.post(
        f"/api/v1/doctors/{seed.doctor_a_id}/leave/preview",
        headers=_headers(seed.admin.subject_id),
        json={
            "starts_at": "2026-08-24T12:00:00Z",
            "ends_at": "2026-08-24T13:00:00Z",
        },
    )
    assert preview_two.status_code == 200
    preview_two_body = preview_two.json()

    async def fail_queue(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("synthetic leave outbox failure")

    monkeypatch.setattr(DomainService, "_queue_integration", fail_queue)
    async with session_factory() as session:
        with pytest.raises(RuntimeError, match="synthetic leave outbox failure"):
            await DomainService(session, _settings(), "leave-rollback").apply_leave(
                seed.admin,
                seed.doctor_a_id,
                LeaveApplyRequest(
                    preview_token=preview_two_body["preview_token"],
                    expected_version=preview_two_body["expected_schedule_version"],
                    reason=None,
                ),
                "leave-rollback-key-0001",
            )
    async with session_factory() as session:
        doctor = await session.get(Doctor, seed.doctor_a_id)
        assert await session.scalar(select(func.count(DoctorLeave.id))) == 1
        assert (await session.get(Appointment, second_appointment)).status == "confirmed"
        assert doctor is not None and doctor.schedule_version == 2
        assert (
            await session.scalar(
                select(func.count(OutboxEvent.id)).where(
                    OutboxEvent.appointment_id == second_appointment,
                    OutboxEvent.dedupe_key.like("appointment-leave-%"),
                )
            )
            == 0
        )


@pytest.mark.asyncio
async def test_appointment_lists_transitions_conflicts_and_idempotency_are_isolated(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
) -> None:
    seed = await seed_domain(session_factory)
    appointment_one = await create_appointment(
        session_factory,
        seed.patients[0],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=10),
        suffix="appt-one",
    )
    appointment_two = await create_appointment(
        session_factory,
        seed.patients[0],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=12),
        suffix="appt-two",
    )
    appointment_three = await create_appointment(
        session_factory,
        seed.patients[0],
        seed.doctor_a_id,
        TEST_NOW.replace(hour=13),
        suffix="appt-three",
    )

    patient_list = await api_client.get(
        "/api/v1/appointments", headers=_headers(seed.patients[0].subject_id)
    )
    other_patient_list = await api_client.get(
        "/api/v1/appointments", headers=_headers(seed.patients[1].subject_id)
    )
    doctor_list = await api_client.get(
        "/api/v1/appointments", headers=_headers(seed.doctor_a.subject_id)
    )
    unrelated_doctor_list = await api_client.get(
        "/api/v1/appointments", headers=_headers(seed.doctor_b.subject_id)
    )
    assert patient_list.status_code == doctor_list.status_code == 200
    assert len(patient_list.json()["items"]) == len(doctor_list.json()["items"]) == 3
    assert other_patient_list.json()["items"] == []
    assert unrelated_doctor_list.json()["items"] == []

    cancel_payload = {"expected_version": 1, "reason_code": "patient_request"}
    cancel_headers = _headers(seed.patients[0].subject_id, key="appointment-cancel-key-0001")
    cancelled = await api_client.post(
        f"/api/v1/appointments/{appointment_two}/cancel",
        headers=cancel_headers,
        json=cancel_payload,
    )
    replay = await api_client.post(
        f"/api/v1/appointments/{appointment_two}/cancel",
        headers=cancel_headers,
        json=cancel_payload,
    )
    reused = await api_client.post(
        f"/api/v1/appointments/{appointment_two}/cancel",
        headers=cancel_headers,
        json={**cancel_payload, "note": "different intent"},
    )
    assert cancelled.status_code == replay.status_code == 200
    assert cancelled.json() == replay.json()
    assert cancelled.json()["status"] == "cancelled_patient"
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    reschedule_cancelled = await api_client.post(
        f"/api/v1/appointments/{appointment_two}/reschedule",
        headers=_headers(seed.patients[0].subject_id, key="reschedule-cancelled-0001"),
        json={"expected_version": 2, "starts_at": "2026-08-24T14:00:00Z", "duration_minutes": 30},
    )
    moved = await api_client.post(
        f"/api/v1/appointments/{appointment_one}/reschedule",
        headers=_headers(seed.patients[0].subject_id, key="reschedule-one-key-0001"),
        json={"expected_version": 1, "starts_at": "2026-08-24T11:00:00Z", "duration_minutes": 30},
    )
    conflict = await api_client.post(
        f"/api/v1/appointments/{appointment_three}/reschedule",
        headers=_headers(seed.patients[0].subject_id, key="reschedule-conflict-0001"),
        json={"expected_version": 1, "starts_at": "2026-08-24T11:00:00Z", "duration_minutes": 30},
    )
    assert reschedule_cancelled.status_code == 409
    assert reschedule_cancelled.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    assert moved.status_code == 200
    assert moved.json()["version"] == 2
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "SLOT_CONFLICT"

    doctor_cancel = await api_client.post(
        f"/api/v1/appointments/{appointment_one}/cancel",
        headers=_headers(seed.doctor_a.subject_id, key="doctor-cancel-key-0001"),
        json={"expected_version": 2, "reason_code": "doctor_request"},
    )
    assert doctor_cancel.status_code == 200
    assert doctor_cancel.json()["status"] == "cancelled_doctor"

    hidden = await api_client.get(
        f"/api/v1/appointments/{appointment_three}",
        headers=_headers(seed.patients[1].subject_id),
    )
    assert hidden.status_code == 404


@pytest.mark.asyncio
async def test_visit_sources_prescription_artifacts_and_reminders_are_persisted(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
) -> None:
    seed = await seed_domain(session_factory)
    appointment_id = await create_appointment(
        session_factory, seed.patients[0], seed.doctor_a_id, TEST_NOW, suffix="visit"
    )
    symptoms = await api_client.post(
        f"/api/v1/appointments/{appointment_id}/symptoms",
        headers=_headers(seed.patients[0].subject_id),
        json={"symptoms_text": "follow-up symptom", "urgency": "urgent"},
    )
    opened = await api_client.post(
        f"/api/v1/appointments/{appointment_id}/visit",
        headers=_headers(seed.doctor_a.subject_id, key="visit-open-key-0001"),
    )
    assert symptoms.status_code == 201
    assert opened.status_code == 200
    assert opened.json()["status"] == "draft"
    assert opened.json()["version"] == 1
    visit_id = UUID(opened.json()["id"])
    before_completion = await api_client.get(
        f"/api/v1/appointments/{appointment_id}/visit",
        headers=_headers(seed.patients[0].subject_id),
    )
    assert before_completion.status_code == 404

    update_visit = await api_client.patch(
        f"/api/v1/visits/{visit_id}",
        headers=_headers(seed.doctor_a.subject_id),
        json={
            "expected_version": 1,
            "notes_text": "original doctor note",
            "urgency": "urgent",
            "advisory_text": "Advisory prose must not drive reminders.",
            "prescription_items": [
                {
                    "medication_name": "Synthetic medicine",
                    "dosage": "10 mg",
                    "route": "oral",
                    "frequency": "twice_daily",
                    "start_date": "2026-08-24",
                    "duration_days": 2,
                    "instructions": "Take with water.",
                }
            ],
        },
    )
    complete = await api_client.post(
        f"/api/v1/visits/{visit_id}/complete",
        headers=_headers(seed.doctor_a.subject_id, key="visit-complete-key-0001"),
        json={"expected_version": 2},
    )
    assert update_visit.status_code == 200
    assert update_visit.json()["prescription"]["status"] == "draft"
    assert complete.status_code == 200
    assert complete.json()["status"] == "completed"
    assert complete.json()["prescription"]["status"] == "completed"
    assert {artifact["status"] for artifact in complete.json()["generated_artifacts"]} == {
        "pending"
    }

    async with session_factory() as session:
        symptoms_rows = list(
            (
                await session.execute(
                    select(SymptomVersion)
                    .where(SymptomVersion.appointment_id == appointment_id)
                    .order_by(SymptomVersion.version)
                )
            ).scalars()
        )
        notes_rows = list(
            (
                await session.execute(
                    select(VisitNoteVersion)
                    .where(VisitNoteVersion.visit_id == visit_id)
                    .order_by(VisitNoteVersion.version)
                )
            ).scalars()
        )
        prescription = await session.scalar(
            select(Prescription).where(Prescription.visit_id == visit_id)
        )
        items = list(
            (
                await session.execute(
                    select(PrescriptionItem).where(
                        PrescriptionItem.prescription_id == prescription.id
                    )
                )
            ).scalars()
        )
        visit_artifacts = list(
            (
                await session.execute(
                    select(GeneratedArtifact).where(GeneratedArtifact.visit_id == visit_id)
                )
            ).scalars()
        )
        appointment_artifacts = list(
            (
                await session.execute(
                    select(GeneratedArtifact).where(
                        GeneratedArtifact.appointment_id == appointment_id
                    )
                )
            ).scalars()
        )
        appointment = await session.get(Appointment, appointment_id)
    assert [row.version for row in symptoms_rows] == [1, 2]
    assert [row.symptoms_text for row in symptoms_rows] == [
        "original symptom visit",
        "follow-up symptom",
    ]
    assert [row.version for row in notes_rows] == [1]
    assert notes_rows[0].notes_text == "original doctor note"
    assert prescription is not None and prescription.status == "completed"
    assert len(items) == 1 and items[0].frequency == "twice_daily"
    assert {artifact.artifact_type for artifact in appointment_artifacts} == {
        "pre_visit_brief",
        "post_visit_summary",
    }
    assert {artifact.artifact_type for artifact in visit_artifacts} == {"post_visit_summary"}
    assert all(artifact.status == "pending" for artifact in appointment_artifacts)
    assert appointment is not None and appointment.status == "completed"

    reminder = await api_client.get(
        f"/api/v1/prescriptions/{prescription.id}/reminder-schedule",
        headers=_headers(seed.patients[0].subject_id),
    )
    reminder_replay = await api_client.get(
        f"/api/v1/prescriptions/{prescription.id}/reminder-schedule",
        headers=_headers(seed.patients[0].subject_id),
    )
    patient_view = await api_client.get(
        f"/api/v1/appointments/{appointment_id}/visit",
        headers=_headers(seed.patients[0].subject_id),
    )
    assert reminder.status_code == 200
    assert reminder_replay.status_code == 200
    assert len(reminder.json()["items"]) == 4
    assert reminder_replay.json() == reminder.json()
    assert patient_view.status_code == 200
    assert patient_view.json()["status"] == "completed"
    assert patient_view.json()["notes"][0]["notes_text"] == "original doctor note"
    assert "provider_reference" not in patient_view.text

    amendment_payload = {
        "expected_version": 3,
        "reason": "corrected synthetic wording",
        "notes_text": "amended doctor note",
    }
    amendment_headers = _headers(seed.doctor_a.subject_id, key="visit-amend-key-0001")
    amendment = await api_client.post(
        f"/api/v1/visits/{visit_id}/amendments",
        headers=amendment_headers,
        json=amendment_payload,
    )
    amendment_replay = await api_client.post(
        f"/api/v1/visits/{visit_id}/amendments",
        headers=amendment_headers,
        json=amendment_payload,
    )
    assert amendment.status_code == amendment_replay.status_code == 200
    assert amendment.json() == amendment_replay.json()
    assert amendment.json()["version"] == 4
    assert [note["notes_text"] for note in amendment.json()["notes"]] == [
        "original doctor note",
        "amended doctor note",
    ]


@pytest.mark.asyncio
async def test_clinical_completion_rolls_back_domain_and_outbox_on_failure(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed = await seed_domain(session_factory)
    appointment_id = await create_appointment(
        session_factory, seed.patients[0], seed.doctor_a_id, TEST_NOW, suffix="clinical-rollback"
    )
    opened = await api_client.post(
        f"/api/v1/appointments/{appointment_id}/visit",
        headers=_headers(seed.doctor_a.subject_id, key="clinical-open-key-0001"),
    )
    visit_id = UUID(opened.json()["id"])
    updated = await api_client.patch(
        f"/api/v1/visits/{visit_id}",
        headers=_headers(seed.doctor_a.subject_id),
        json={"expected_version": 1, "notes_text": "rollback note"},
    )
    assert updated.status_code == 200

    async def fail_queue(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("synthetic clinical outbox failure")

    monkeypatch.setattr(DomainService, "_queue_integration", fail_queue)
    response = await api_client.post(
        f"/api/v1/visits/{visit_id}/complete",
        headers=_headers(seed.doctor_a.subject_id, key="clinical-complete-key-0001"),
        json={"expected_version": 2},
    )
    assert response.status_code == 500

    async with session_factory() as session:
        visit = await session.get(Visit, visit_id)
        appointment = await session.get(Appointment, appointment_id)
        post_artifacts = list(
            (
                await session.execute(
                    select(GeneratedArtifact).where(
                        GeneratedArtifact.visit_id == visit_id,
                        GeneratedArtifact.artifact_type == "post_visit_summary",
                    )
                )
            ).scalars()
        )
        post_events = await session.scalar(
            select(func.count(OutboxEvent.id)).where(
                OutboxEvent.appointment_id == appointment_id,
                OutboxEvent.dedupe_key.like("visit-post-summary:%"),
            )
        )
    assert visit is not None and visit.status == "draft"
    assert appointment is not None and appointment.status == "in_progress"
    assert post_artifacts == []
    assert post_events == 0


@pytest.mark.asyncio
async def test_integration_status_listing_retry_and_authorization(
    session_factory: async_sessionmaker[AsyncSession],
    api_client: httpx.AsyncClient,
) -> None:
    seed = await seed_domain(session_factory)
    appointment_id = await create_appointment(
        session_factory, seed.patients[0], seed.doctor_a_id, TEST_NOW, suffix="integration"
    )
    async with session_factory() as session:
        async with session.begin():
            operation = await session.scalar(
                select(IntegrationOperation)
                .where(
                    IntegrationOperation.appointment_id == appointment_id,
                    IntegrationOperation.channel == "email",
                )
                .with_for_update()
            )
            assert operation is not None
            operation.state = "failed"
            operation.error_code = "PROVIDER_TEMPORARY_FAILURE"
            operation.version = 1
            outbox = await session.get(OutboxEvent, operation.outbox_event_id, with_for_update=True)
            assert outbox is not None
            outbox.status = "failed"
            outbox.last_error_code = "PROVIDER_TEMPORARY_FAILURE"

    failed = await api_client.get(
        "/api/v1/admin/integrations",
        params={"state": "failed", "channel": "email"},
        headers=_headers(seed.admin.subject_id),
    )
    patient_forbidden = await api_client.get(
        "/api/v1/admin/integrations", headers=_headers(seed.patients[0].subject_id)
    )
    doctor_forbidden = await api_client.get(
        "/api/v1/admin/integrations", headers=_headers(seed.doctor_a.subject_id)
    )
    patient_status = await api_client.get(
        f"/api/v1/appointments/{appointment_id}/integrations",
        headers=_headers(seed.patients[0].subject_id),
    )
    patient_retry = await api_client.post(
        "/api/v1/admin/integrations/00000000-0000-0000-0000-000000000001/retry",
        headers=_headers(seed.patients[0].subject_id, key="patient-retry-key-0001"),
        json={"expected_version": 1},
    )
    assert failed.status_code == 200
    assert len(failed.json()["items"]) == 1
    assert failed.json()["items"][0]["state"] == "failed"
    assert patient_forbidden.status_code == doctor_forbidden.status_code == 403
    assert patient_status.status_code == 200
    assert "provider_reference" not in patient_status.text
    assert patient_retry.status_code == 403

    operation_id = failed.json()["items"][0]["id"]
    retry_payload = {"expected_version": 1}
    retry_headers = _headers(seed.admin.subject_id, key="admin-retry-key-0001")
    retried = await api_client.post(
        f"/api/v1/admin/integrations/{operation_id}/retry",
        headers=retry_headers,
        json=retry_payload,
    )
    replay = await api_client.post(
        f"/api/v1/admin/integrations/{operation_id}/retry",
        headers=retry_headers,
        json=retry_payload,
    )
    assert retried.status_code == replay.status_code == 200
    assert retried.json() == replay.json()
    assert retried.json()["state"] == "pending"
    assert retried.json()["attempt_count"] == 1

    async with session_factory() as session:
        operation = await session.get(IntegrationOperation, UUID(operation_id))
        assert operation is not None
        outbox = await session.get(OutboxEvent, operation.outbox_event_id)
    assert operation is not None and operation.state == "pending"
    assert outbox is not None and outbox.status == "pending" and outbox.attempt_count == 1

    invalid_transition = await api_client.post(
        f"/api/v1/admin/integrations/{operation_id}/retry",
        headers=_headers(seed.admin.subject_id, key="admin-retry-key-0002"),
        json={"expected_version": 2},
    )
    assert invalid_transition.status_code == 409
    assert invalid_transition.json()["error"]["code"] == "INVALID_STATE_TRANSITION"
