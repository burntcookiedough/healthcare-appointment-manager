"""Stable API error vocabulary and FastAPI exception handlers."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ErrorField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    code: str
    message: str


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    fields: list[ErrorField] | None = None
    retryable: bool = False
    details: dict[str, Any] | None = None


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorBody
    request_id: str


class ApiError(Exception):
    """Expected domain failure that is safe to expose to clients."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        fields: Sequence[ErrorField] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable
        self.fields = list(fields) if fields else None
        self.details = details

    def envelope(self, request_id: str) -> ErrorEnvelope:
        return ErrorEnvelope(
            error=ErrorBody(
                code=self.code,
                message=self.message,
                fields=self.fields,
                retryable=self.retryable,
                details=self.details,
            ),
            request_id=request_id,
        )


def _request_id(request: Request) -> str:
    return str(request.scope.get("healthcare_request_id", "unknown"))


def _response(request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content=error.envelope(_request_id(request)).model_dump(mode="json", exclude_none=True),
    )


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):  # pragma: no cover - Starlette dispatch guarantee
        return _response(request, ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred."))
    return _response(request, exc)


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(
        exc, RequestValidationError
    ):  # pragma: no cover - Starlette dispatch guarantee
        return _response(request, ApiError(422, "VALIDATION_FAILED", "Request validation failed."))
    fields: list[ErrorField] = []
    for item in exc.errors():
        location = [
            str(part)
            for part in item.get("loc", ())
            if part not in {"body", "query", "path", "header"}
        ]
        fields.append(
            ErrorField(
                path=".".join(location) or "request",
                code="invalid",
                message="The supplied value is invalid.",
            )
        )
    return _response(
        request,
        ApiError(
            422,
            "VALIDATION_FAILED",
            "Request validation failed.",
            fields=fields,
        ),
    )


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(
        exc, StarletteHTTPException
    ):  # pragma: no cover - Starlette dispatch guarantee
        return _response(
            request, ApiError(400, "INVALID_REQUEST", "The request could not be completed.")
        )
    mapping = {
        401: ("AUTHENTICATION_REQUIRED", "Authentication is required."),
        403: ("FORBIDDEN", "Access is forbidden."),
        404: ("RESOURCE_NOT_FOUND", "The requested resource was not found."),
    }
    code, message = mapping.get(
        exc.status_code, ("INVALID_REQUEST", "The request could not be completed.")
    )
    return _response(request, ApiError(exc.status_code, code, message))


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_api_error", extra={"request_id": _request_id(request), "outcome": "error"}
    )
    return _response(request, ApiError(500, "INTERNAL_ERROR", "An unexpected error occurred."))
