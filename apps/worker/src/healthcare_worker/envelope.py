"""Versioned, PHI-minimized outbox event envelopes."""

from __future__ import annotations

import re
from collections.abc import Mapping
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, RootModel, model_validator

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]

# Payloads are references and routing metadata, not copies of clinical records.
# This is intentionally a deny-list at the envelope boundary so a future event
# cannot accidentally put source text into a queue message.
SENSITIVE_PAYLOAD_KEYS = frozenset(
    {
        "access_token",
        "calendar_description",
        "clinical_payload",
        "clinical_text",
        "diagnosis",
        "diagnosis_text",
        "doctor_notes",
        "email_body",
        "email_content",
        "free_text",
        "llm_prompt",
        "medication",
        "name",
        "model_response",
        "notes",
        "patient_notes",
        "patient_text",
        "phone",
        "prescription",
        "prescription_text",
        "prompt",
        "reason",
        "refresh_token",
        "secret",
        "symptom_text",
        "symptoms",
        "symptoms_text",
        "address",
        "email",
        "body",
        "date_of_birth",
        "dob",
    }
)
_NORMALIZE_KEY = re.compile(r"[^a-z0-9_]+")
_SENSITIVE_KEY_PARTS = (
    "symptom",
    "note",
    "diagnos",
    "prescription",
    "clinical",
    "email",
    "phone",
    "address",
    "token",
    "secret",
    "prompt",
    "response",
    "content",
    "body",
    "_text",
)


def _is_sensitive_key(key: str) -> bool:
    normalized = _NORMALIZE_KEY.sub("_", key.casefold()).strip("_")
    if normalized.endswith(("_id", "_uuid", "_ref", "_reference")):
        return False
    if normalized.endswith("_name"):
        return True
    return normalized in SENSITIVE_PAYLOAD_KEYS or any(
        part in normalized for part in _SENSITIVE_KEY_PARTS
    )


def _validate_safe_value(value: JsonValue, *, path: str) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _is_sensitive_key(str(key)):
                raise ValueError(f"payload field at {path}.{key} is not allowed")
            _validate_safe_value(child, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_safe_value(child, path=f"{path}[{index}]")


class SafePayload(RootModel[dict[str, JsonValue]]):
    """JSON-safe routing metadata with common clinical fields rejected."""

    @model_validator(mode="after")
    def reject_sensitive_fields(self) -> SafePayload:
        _validate_safe_value(self.root, path="payload")
        return self

    def as_dict(self) -> dict[str, JsonValue]:
        """Return a copy suitable for an adapter request builder."""

        return dict(self.root)


class EventEnvelope(BaseModel):
    """The minimum event contract shared by API outbox and Celery.

    ``event_id`` is the stable outbox UUID and therefore the idempotency key for
    provider calls.  ``aggregate_id`` is opaque application identity; it is never
    a patient name, email address, or clinical value.
    """

    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1, validation_alias=AliasChoices("version", "schema_version"))
    event_id: UUID = Field(
        validation_alias=AliasChoices("event_id", "event_uuid", "outbox_event_id", "outbox_id")
    )
    correlation_id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    aggregate_id: UUID
    event_type: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    )
    payload: SafePayload

    @property
    def outbox_event_id(self) -> UUID:
        """Alias used by callers that name the UUID after its durable row."""

        return self.event_id

    @property
    def deduplication_key(self) -> str:
        """Stable key that does not contain payload or user-provided text."""

        return str(self.event_id)


# Descriptive alias for callers that use the durable-row vocabulary.
OutboxEvent = EventEnvelope
