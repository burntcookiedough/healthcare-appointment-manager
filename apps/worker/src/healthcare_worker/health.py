"""Coarse worker liveness/readiness responses with no dependency disclosure."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


async def live_status(*, service: str = "healthcare-worker") -> dict[str, str]:
    """Process liveness never contacts Redis, PostgreSQL, or providers."""

    return {"status": "ok", "service": service}


async def ready_status(
    check_database: Callable[[], bool | Awaitable[bool]] | None = None,
    *,
    service: str = "healthcare-worker",
) -> dict[str, str]:
    """Return only ``ok``/``unavailable``; never expose hosts, secrets, or errors."""

    if check_database is None:
        return {"status": "ok", "service": service}
    try:
        checked = check_database()
        if hasattr(checked, "__await__"):
            checked = await checked
        return {"status": "ok" if checked else "unavailable", "service": service}
    except Exception:
        return {"status": "unavailable", "service": service}


def live_status_sync(*, service: str = "healthcare-worker") -> dict[str, str]:
    """Synchronous health helper for process managers and smoke tests."""

    return {"status": "ok", "service": service}


def readiness_status_sync(
    check_database: Callable[[], bool] | None = None,
    *,
    service: str = "healthcare-worker",
) -> dict[str, str]:
    if check_database is None:
        return {"status": "ok", "service": service}
    try:
        healthy = check_database()
    except Exception:
        healthy = False
    return {"status": "ok" if healthy else "unavailable", "service": service}


def health_payload(status: dict[str, str]) -> dict[str, Any]:
    """Return a JSON-safe copy, useful for an HTTP framework integration."""

    return {
        "status": status.get("status", "unavailable"),
        "service": status.get("service", "healthcare-worker"),
    }


health_live = live_status_sync
health_ready = readiness_status_sync
