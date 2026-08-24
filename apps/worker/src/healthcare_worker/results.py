"""Safe result vocabulary for worker and provider operations."""

from __future__ import annotations

from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProcessingOutcome(StrEnum):
    """Outcome classes that drive durable state and Celery retry behavior."""

    SUCCEEDED = "succeeded"
    RETRYABLE_FAILURE = "retryable_failure"
    TERMINAL_FAILURE = "terminal_failure"
    SUCCESS = "succeeded"
    RETRYABLE = "retryable_failure"
    TERMINAL = "terminal_failure"


class ProcessingResult(BaseModel):
    """A machine-readable result that never carries provider or clinical text."""

    model_config = ConfigDict(extra="forbid")

    event_id: UUID | None = None
    outcome: ProcessingOutcome
    error_code: str | None = Field(default=None, max_length=80)
    provider_reference: str | None = Field(default=None, max_length=200)
    retry_after_seconds: float | None = Field(default=None, ge=0, le=3600)
    deduplicated: bool = False
    attempt: int | None = Field(default=None, ge=0)

    @property
    def is_success(self) -> bool:
        return self.outcome is ProcessingOutcome.SUCCEEDED

    @property
    def is_retryable(self) -> bool:
        return self.outcome is ProcessingOutcome.RETRYABLE_FAILURE

    @classmethod
    def success(
        cls,
        event_id: UUID,
        *,
        provider_reference: str | None = None,
        deduplicated: bool = False,
    ) -> ProcessingResult:
        return cls(
            event_id=event_id,
            outcome=ProcessingOutcome.SUCCEEDED,
            provider_reference=provider_reference,
            deduplicated=deduplicated,
        )

    @classmethod
    def retryable(
        cls,
        event_id: UUID,
        *,
        error_code: str,
        retry_after_seconds: float | None = None,
        attempt: int | None = None,
    ) -> ProcessingResult:
        return cls(
            event_id=event_id,
            outcome=ProcessingOutcome.RETRYABLE_FAILURE,
            error_code=error_code,
            retry_after_seconds=retry_after_seconds,
            attempt=attempt,
        )

    @classmethod
    def terminal(
        cls,
        event_id: UUID | None,
        *,
        error_code: str,
        attempt: int | None = None,
    ) -> ProcessingResult:
        return cls(
            event_id=event_id,
            outcome=ProcessingOutcome.TERMINAL_FAILURE,
            error_code=error_code,
            attempt=attempt,
        )

    def with_attempt(self, attempt: int) -> ProcessingResult:
        """Return a copy annotated with the current delivery attempt."""

        return self.model_copy(update={"attempt": attempt})
