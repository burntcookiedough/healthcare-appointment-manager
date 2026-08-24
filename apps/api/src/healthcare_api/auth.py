"""Narrow actor/auth boundary for Phase 1.

The default implementation accepts a bearer subject and resolves it against the
application actor table.  Supabase JWT verification is intentionally deferred.  Tests
can override ``get_current_actor`` without reaching authentication infrastructure.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .errors import ApiError
from .models import Actor, Doctor, PatientProfile

Role = Literal["patient", "doctor", "admin"]
bearer_scheme = HTTPBearer(auto_error=False, scheme_name="SupabaseBearer")


@dataclass(frozen=True, slots=True)
class ActorContext:
    """Authenticated application actor and profile references."""

    id: str
    subject_id: str
    role: Role
    patient_id: str | None = None
    doctor_id: str | None = None


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> ActorContext:
    """Resolve a bearer subject to an active application actor."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")

    subject_id = credentials.credentials.strip()
    if subject_id.startswith("test:"):
        subject_id = subject_id[5:]
    result = await session.execute(
        select(Actor).where(Actor.subject_id == subject_id, Actor.is_active.is_(True))
    )
    actor = result.scalar_one_or_none()
    if actor is None:
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")

    patient_id: str | None = None
    doctor_id: str | None = None
    if actor.role == "patient":
        profile = await session.scalar(
            select(PatientProfile.actor_id).where(PatientProfile.actor_id == actor.id)
        )
        if profile is None:
            raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        patient_id = str(profile)
    elif actor.role == "doctor":
        profile = await session.scalar(select(Doctor.id).where(Doctor.actor_id == actor.id))
        if profile is None:
            raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        doctor_id = str(profile)

    # The lookup is read-only.  End the implicit SQLAlchemy transaction so the
    # booking service can own the following mutation transaction explicitly.
    await session.commit()

    return ActorContext(
        id=str(actor.id),
        subject_id=actor.subject_id,
        role=actor.role,  # type: ignore[arg-type]
        patient_id=patient_id,
        doctor_id=doctor_id,
    )


def require_role(*roles: Role) -> Any:
    """Build a dependency enforcing a role without leaking resource details."""

    async def dependency(actor: ActorContext = Depends(get_current_actor)) -> ActorContext:
        if actor.role not in roles:
            raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
        return actor

    return dependency
