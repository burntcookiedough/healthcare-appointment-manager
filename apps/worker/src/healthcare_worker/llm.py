"""Validated clinical LLM artifacts and prompt metadata.

The worker treats model output as untrusted derived data.  The source record,
structured prescriptions, and visit notes remain owned by the API/database; this
module only defines the small schemas that may be persisted as generated output.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class Urgency(StrEnum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"


def _clean_text(value: str, *, max_length: int = 2_000) -> str:
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        raise ValueError("generated text cannot be empty")
    if len(cleaned) > max_length:
        raise ValueError("generated text is too long")
    return cleaned


class PreVisitOutput(BaseModel):
    """Exact pre-visit shape: urgency, chief complaint, and three questions."""

    model_config = ConfigDict(extra="forbid")

    urgency: Urgency = Field(description="Informational urgency: Low, Medium, or High")
    chief_complaint: str = Field(
        min_length=1,
        max_length=500,
        description="A concise, non-diagnostic statement of the main concern",
    )
    suggested_questions: list[str] = Field(
        min_length=3,
        max_length=3,
        description="Exactly three concise questions for the clinician",
    )

    @field_validator("chief_complaint")
    @classmethod
    def validate_complaint(cls, value: str) -> str:
        return _clean_text(value, max_length=500)

    @field_validator("suggested_questions")
    @classmethod
    def validate_questions(cls, value: list[str]) -> list[str]:
        if len(value) != 3:
            raise ValueError("exactly three suggested questions are required")
        return [_clean_text(item, max_length=500) for item in value]


class PostVisitOutput(BaseModel):
    """Patient-facing, non-diagnostic follow-up summary shape."""

    model_config = ConfigDict(extra="forbid")

    summary: str = Field(
        min_length=1,
        max_length=4_000,
        validation_alias=AliasChoices("summary", "patient_summary"),
        description="A clear, patient-friendly explanation of the documented visit",
    )
    next_steps: list[str] = Field(
        default_factory=list,
        max_length=20,
        validation_alias=AliasChoices("next_steps", "follow_up_steps"),
        description="Actionable follow-up steps already present in the source note",
    )
    warning_signs: list[str] = Field(
        default_factory=list,
        max_length=20,
        validation_alias=AliasChoices("warning_signs", "when_to_seek_help"),
        description="When to contact the care team or seek urgent help; do not diagnose",
    )

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, value: str) -> str:
        return _clean_text(value, max_length=4_000)

    @field_validator("next_steps", "warning_signs")
    @classmethod
    def validate_lists(cls, value: list[str]) -> list[str]:
        return [_clean_text(item, max_length=500) for item in value]


class PromptMetadata(BaseModel):
    """Versioned provenance attached to every successful generated artifact."""

    model_config = ConfigDict(extra="forbid")

    task_kind: str = Field(min_length=1, max_length=80)
    prompt_version: str = Field(min_length=1, max_length=64)
    schema_version: str = Field(min_length=1, max_length=64)
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=128)


class GeneratedSummaryRecord(BaseModel):
    """Persistence contract for a validated generated artifact."""

    model_config = ConfigDict(extra="forbid")

    source_record_reference: UUID
    source_version: int = Field(ge=1)
    task_kind: str = Field(min_length=1, max_length=80)
    metadata: PromptMetadata
    output: PreVisitOutput | PostVisitOutput
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class SummaryRepository(Protocol):
    """Repository port for generated summaries and failure states."""

    def persist_summary(self, record: GeneratedSummaryRecord) -> None:
        """Persist one validated artifact, keyed by source/version/task metadata."""


class InMemorySummaryRepository:
    """Deterministic repository used by tests and local fake mode."""

    def __init__(self) -> None:
        self.records: list[GeneratedSummaryRecord] = []
        self._keys: set[tuple[UUID, int, str, str, str]] = set()

    def persist_summary(self, record: GeneratedSummaryRecord) -> None:
        key = (
            record.source_record_reference,
            record.source_version,
            record.task_kind,
            record.metadata.prompt_version,
            record.metadata.schema_version,
        )
        if key in self._keys:
            return
        self._keys.add(key)
        self.records.append(record)


def output_model_for_task(task_kind: str) -> type[PreVisitOutput] | type[PostVisitOutput]:
    """Resolve the only two supported clinical output schemas."""

    if task_kind == "pre_visit":
        return PreVisitOutput
    if task_kind in {"post_visit", "plain_language_summary"}:
        return PostVisitOutput
    raise ValueError("unsupported clinical summary task")


def output_schema_for_task(task_kind: str) -> dict[str, Any]:
    """Return a provider-neutral JSON schema with strict object properties."""

    schema = output_model_for_task(task_kind).model_json_schema()
    schema["additionalProperties"] = False
    return schema


PreVisitSummary = PreVisitOutput
PostVisitSummary = PostVisitOutput
