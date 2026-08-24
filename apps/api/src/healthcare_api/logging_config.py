"""Safe structured logging setup."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

_SENSITIVE_KEYS = {
    "authorization",
    "access_token",
    "refresh_token",
    "password",
    "symptoms_text",
    "notes",
    "prescription",
    "prompt",
    "model_response",
}


def _safe(value: Any, key: str | None = None) -> Any:
    if key and key.lower() in _SENSITIVE_KEYS:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {str(k): _safe(v, str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    """Emit one compact JSON object per log record without sensitive values."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "service",
            "environment",
            "operation",
            "outcome",
            "request_id",
            "duration_ms",
            "error_code",
        ):
            if hasattr(record, key):
                payload[key] = _safe(getattr(record, key), key)
        if record.exc_info:
            payload["exception"] = "unexpected_exception"
        return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def configure_logging(level: str = "INFO") -> None:
    """Configure a single safe stream handler for the API process."""

    root = logging.getLogger()
    root.setLevel(level.upper())
    handler = next(
        (item for item in root.handlers if getattr(item, "_healthcare_json", False)), None
    )
    if handler is None:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        handler.__dict__["_healthcare_json"] = True
        root.addHandler(handler)
