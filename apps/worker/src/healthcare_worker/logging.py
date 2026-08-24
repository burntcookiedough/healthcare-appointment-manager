"""Structured logging helpers with an explicit PHI-safe field allow-list."""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from .events import KNOWN_EVENT_TYPES

SAFE_LOG_KEYS = frozenset(
    {
        "aggregate_id",
        "attempt",
        "correlation_id",
        "deduplicated",
        "error_code",
        "event_id",
        "event_type",
        "outcome",
        "retry_after_seconds",
        "service",
    }
)


def _safe_fields(fields: Mapping[str, Any]) -> dict[str, Any]:
    """Keep only stable identifiers and bounded operational values."""

    return {key: fields[key] for key in SAFE_LOG_KEYS if key in fields}


def safe_event_type(event_type: str) -> str:
    """Avoid echoing an untrusted/custom event name into operational logs."""

    return event_type if event_type in KNOWN_EVENT_TYPES else "custom"


def safe_log(
    logger: logging.Logger,
    level: int,
    event: str,
    *,
    fields: Mapping[str, Any] | None = None,
) -> None:
    """Emit a constant event name and allow-listed fields.

    Callers must pass the event payload separately from this helper; it is never
    interpolated into the log message and is therefore not accidentally emitted.
    """

    logger.log(
        level,
        "worker_event",
        extra={"safe_event": event, "safe_fields": _safe_fields(fields or {})},
    )


class SafeJsonFormatter(logging.Formatter):
    """Serialize only the safe operational portion of a ``LogRecord``."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "safe_event", "unstructured_log"),
        }
        record_fields = getattr(record, "safe_fields", {})
        if isinstance(record_fields, Mapping):
            payload.update(_safe_fields(record_fields))
        return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def configure_logging(level: int = logging.INFO) -> None:
    """Install one safe JSON handler for the worker process."""

    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler()
    handler.setFormatter(SafeJsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
