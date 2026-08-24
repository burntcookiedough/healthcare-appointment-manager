"""Phase 1 availability, hold, and confirmation routes."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import ActorContext, require_role
from ..booking import BookingService, ServiceResult
from ..config import get_settings
from ..db import get_session
from ..errors import ApiError
from ..schemas import (
    AppointmentResponse,
    AvailabilityResponse,
    AvailabilitySlot,
    HoldConfirmRequest,
    HoldCreateRequest,
    HoldResponse,
)

router = APIRouter(tags=["booking"])


def _request_id(request: Request) -> str:
    return str(request.scope.get("healthcare_request_id", "unknown"))


def _service(session: AsyncSession, request: Request) -> BookingService:
    return BookingService(session, get_settings(), _request_id(request))


def _result_or_raise(result: ServiceResult) -> dict[str, object]:
    if result.error is not None:
        raise result.error
    return result.body


@router.get(
    "/doctors/{doctor_id}/availability",
    response_model=AvailabilityResponse,
    operation_id="getDoctorAvailability",
)
async def get_availability(
    doctor_id: UUID,
    request: Request,
    from_: datetime = Query(alias="from"),
    to: datetime = Query(),
    duration_minutes: int = Query(ge=1, le=480),
    actor: ActorContext = Depends(require_role("patient", "doctor", "admin")),
    session: AsyncSession = Depends(get_session),
) -> AvailabilityResponse:
    if actor.role == "doctor" and actor.doctor_id != str(doctor_id):
        raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
    slots = await _service(session, request).availability(doctor_id, from_, to, duration_minutes)
    return AvailabilityResponse(items=[AvailabilitySlot.model_validate(slot) for slot in slots])


@router.post(
    "/holds",
    response_model=HoldResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="createHold",
)
async def create_hold(
    payload: HoldCreateRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> HoldResponse:
    result = await _service(session, request).create_hold(actor, payload, idempotency_key)
    return HoldResponse.model_validate(_result_or_raise(result))


@router.get(
    "/holds/{hold_id}",
    response_model=HoldResponse,
    operation_id="getHold",
)
async def get_hold(
    hold_id: UUID,
    request: Request,
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> HoldResponse:
    hold = await _service(session, request).get_hold(actor, hold_id)
    return HoldResponse.model_validate(hold)


@router.delete(
    "/holds/{hold_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="releaseHold",
)
async def release_hold(
    hold_id: UUID,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> Response:
    result = await _service(session, request).release_hold(actor, hold_id, idempotency_key)
    _result_or_raise(result)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/holds/{hold_id}/confirm",
    response_model=AppointmentResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="confirmHold",
)
async def confirm_hold(
    hold_id: UUID,
    payload: HoldConfirmRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    actor: ActorContext = Depends(require_role("patient")),
    session: AsyncSession = Depends(get_session),
) -> AppointmentResponse:
    result = await _service(session, request).confirm_hold(actor, hold_id, payload, idempotency_key)
    return AppointmentResponse.model_validate(_result_or_raise(result))
