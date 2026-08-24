"""Public liveness and coarse readiness endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session
from ..errors import ApiError
from ..schemas import ErrorResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health/live", response_model=HealthResponse, operation_id="getHealthLive")
async def health_live() -> HealthResponse:
    """Return process liveness without dependency or environment details."""

    return HealthResponse(status="ok")


@router.get(
    "/health/ready",
    response_model=HealthResponse,
    operation_id="getHealthReady",
    responses={
        503: {
            "model": ErrorResponse,
            "description": "A required dependency is unavailable.",
        }
    },
)
async def health_ready(session: AsyncSession = Depends(get_session)) -> HealthResponse:
    """Return coarse readiness when PostgreSQL is reachable."""

    try:
        await asyncio.wait_for(
            session.execute(text("SELECT 1")), timeout=get_settings().readiness_timeout_seconds
        )
        await session.rollback()
    except Exception as exc:  # noqa: BLE001 - readiness must not disclose internals
        await session.rollback()
        raise ApiError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "A required dependency is unavailable.",
            retryable=True,
        ) from exc
    return HealthResponse(status="ok")
