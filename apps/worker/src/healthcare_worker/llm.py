"""Validated clinical LLM artifacts and prompt metadata.

The worker treats model output as untrusted derived data.  The source record,
structured prescriptions, and visit notes remain owned by the API/database; this
module only defines the small schemas that may be persisted as generated output.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable
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

    def persist_summary(self, record: GeneratedSummaryRecord) -> None | Awaitable[None]:
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


class PostgresSummaryRepository:
    """Persist successful generated artifacts into the API-owned PostgreSQL rows.

    The API creates a pending ``generated_artifacts`` row in the same transaction
    that queues an LLM event.  The worker updates that row only after provider
    output has passed the application schema, using the source reference/version
    as a stale-write fence.  The repository is asynchronous because the production
    runtime shares an ``asyncpg`` pool with the durable outbox store.
    """

    PRE_VISIT_UPDATE_SQL = """
    UPDATE generated_artifacts AS artifact
    SET status = 'succeeded',
        content = $4,
        source_versions = artifact.source_versions || $5::jsonb,
        task_version = 'v1',
        provider = $6,
        model = $7,
        error_code = NULL,
        updated_at = now()
    FROM symptom_versions AS symptom
    WHERE symptom.id = $1
      AND symptom.version = $2
      AND artifact.source_record_id = symptom.id
      AND artifact.source_record_type = 'symptom_version'
      AND artifact.artifact_type = 'pre_visit_brief'
      AND artifact.source_versions->>'symptom_version' = $3
    """

    POST_VISIT_UPDATE_SQL = """
    UPDATE generated_artifacts AS artifact
    SET status = 'succeeded',
        content = $4,
        source_versions = artifact.source_versions || $5::jsonb,
        task_version = 'v1',
        provider = $6,
        model = $7,
        error_code = NULL,
        updated_at = now()
    FROM visits AS visit
    JOIN LATERAL (
        SELECT note.id
        FROM visit_note_versions AS note
        WHERE note.visit_id = visit.id
        ORDER BY note.version DESC, note.id DESC
        LIMIT 1
    ) AS latest_note ON TRUE
    WHERE visit.id = $1
      AND visit.version = $2
      AND artifact.visit_id = visit.id
      AND artifact.appointment_id = visit.appointment_id
      AND artifact.source_record_id = latest_note.id
      AND artifact.source_record_type = 'visit_note'
      AND artifact.artifact_type = 'post_visit_summary'
      AND artifact.source_versions->>'visit_version' = $3
    """

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    async def persist_summary(self, record: GeneratedSummaryRecord) -> None:
        """Update the pre-created artifact, failing closed if its source is stale."""

        if record.task_kind == "pre_visit":
            statement = self.PRE_VISIT_UPDATE_SQL
            source_version_key = "symptom_version"
        elif record.task_kind in {"post_visit", "plain_language_summary"}:
            statement = self.POST_VISIT_UPDATE_SQL
            source_version_key = "visit_version"
        else:
            raise ValueError("unsupported summary task")

        content = json.dumps(
            record.output.model_dump(mode="json"), ensure_ascii=True, separators=(",", ":")
        )
        metadata = json.dumps(
            {
                "prompt_version": record.metadata.prompt_version,
                "schema_version": record.metadata.schema_version,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
        source_version = str(record.source_version)
        async with self._pool.acquire() as connection, connection.transaction():
            status = await connection.execute(
                statement,
                record.source_record_reference,
                record.source_version,
                source_version,
                content,
                metadata,
                record.metadata.provider,
                record.metadata.model,
            )
        if not _updated_one(status):
            # The source resolver already authorized this reference.  A missing
            # pending row means the API transaction was rolled back, the artifact
            # was superseded, or a stale worker raced a newer version.
            raise ValueError(f"summary artifact source fence failed: {source_version_key}")


def _updated_one(status: int | str) -> bool:
    """Interpret asyncpg's ``UPDATE n`` result without exposing driver details."""

    if isinstance(status, int):
        return status == 1
    try:
        return int(str(status).split()[-1]) == 1
    except (TypeError, ValueError):
        return str(status).upper().endswith(" 1")


def output_model_for_task(task_kind: str) -> type[PreVisitOutput] | type[PostVisitOutput]:
    """Resolve the only two supported clinical output schemas."""

    if task_kind == "pre_visit":
        return PreVisitOutput
    if task_kind in {"post_visit", "plain_language_summary"}:
        return PostVisitOutput
    raise ValueError("unsupported clinical summary task")


def output_schema_for_task(task_kind: str) -> dict[str, Any]:
    """Return a provider-neutral schema compatible with OpenAI strict mode.

    Pydantic omits fields with defaults from ``required``.  OpenAI's strict
    structured-output mode requires every declared property to be required, so
    normalize object schemas recursively while preserving the application model's
    validation types (including any explicit nullable unions).
    """

    schema = output_model_for_task(task_kind).model_json_schema()

    def normalize(node: object) -> None:
        if not isinstance(node, dict):
            return
        properties = node.get("properties")
        if isinstance(properties, dict):
            node["required"] = list(properties)
            node["additionalProperties"] = False
            for property_schema in properties.values():
                normalize(property_schema)
        for key in ("items", "anyOf", "oneOf", "allOf", "prefixItems"):
            child = node.get(key)
            if isinstance(child, dict):
                normalize(child)
            elif isinstance(child, list):
                for item in child:
                    normalize(item)

    normalize(schema)
    schema["additionalProperties"] = False
    return schema


PreVisitSummary = PreVisitOutput
PostVisitSummary = PostVisitOutput
