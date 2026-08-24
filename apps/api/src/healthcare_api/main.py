"""FastAPI application factory and process entrypoint."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from .config import get_settings
from .db import engine
from .errors import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    unhandled_exception_handler,
    validation_error_handler,
)
from .logging_config import configure_logging
from .middleware import RequestIdMiddleware
from .routers.booking import router as booking_router
from .routers.health import router as health_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Healthcare Appointment and Follow-up API",
        version="0.0.0",
        description="Phase 1 booking foundation with PostgreSQL-authoritative slot ownership.",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=f"{settings.api_prefix}/redoc",
        lifespan=lifespan,
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_exception_handler(401, http_exception_handler)
    app.add_exception_handler(403, http_exception_handler)
    app.add_exception_handler(404, http_exception_handler)
    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(booking_router, prefix=settings.api_prefix)
    # Local tooling often probes /health/* before knowing the API base path.  Keep a
    # schema-hidden alias while the documented contract remains /api/v1/health/*.
    app.include_router(health_router, include_in_schema=False)
    return app


app = create_app()
