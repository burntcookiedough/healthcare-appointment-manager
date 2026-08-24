"""Provider-neutral ports and safe request/result models.

Real SendGrid, Google OAuth/Calendar, and LLM clients are intentionally absent in
Phase 1.  These ports keep later adapters from changing handler semantics.
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .results import ProcessingOutcome


class AdapterResult(BaseModel):
    """Normalized provider result with no provider exception text."""

    model_config = ConfigDict(extra="forbid")

    outcome: ProcessingOutcome
    provider_reference: str | None = Field(default=None, max_length=200)
    error_code: str | None = Field(default=None, max_length=80)
    retry_after_seconds: float | None = Field(default=None, ge=0, le=3600)

    @classmethod
    def success(cls, provider_reference: str | None = None) -> AdapterResult:
        return cls(outcome=ProcessingOutcome.SUCCEEDED, provider_reference=provider_reference)

    @classmethod
    def retryable(
        cls,
        error_code: str = "PROVIDER_TEMPORARY_FAILURE",
        retry_after_seconds: float | None = None,
    ) -> AdapterResult:
        return cls(
            outcome=ProcessingOutcome.RETRYABLE_FAILURE,
            error_code=error_code,
            retry_after_seconds=retry_after_seconds,
        )

    @classmethod
    def terminal(cls, error_code: str = "PROVIDER_TERMINAL_FAILURE") -> AdapterResult:
        return cls(outcome=ProcessingOutcome.TERMINAL_FAILURE, error_code=error_code)


class EmailRequest(BaseModel):
    """Minimum notification metadata; the body is rendered outside the queue."""

    model_config = ConfigDict(extra="forbid")

    template_key: str = Field(default="appointment_update", min_length=1, max_length=80)
    recipient_reference: str | None = Field(default=None, max_length=128)
    appointment_id: UUID | None = None
    locale: str = Field(default="en", min_length=2, max_length=16)


class CalendarRequest(BaseModel):
    """Minimum appointment projection fields; no clinical text or free-form body."""

    model_config = ConfigDict(extra="forbid")

    appointment_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    time_zone: str | None = Field(default=None, max_length=64)
    event_label: str = Field(default="Healthcare appointment", max_length=80)


class ClinicalSummaryRequest(BaseModel):
    """Reference-only LLM request; source text is fetched behind a later port."""

    model_config = ConfigDict(extra="forbid")

    source_record_reference: UUID | None = None
    source_version: int | None = Field(default=None, ge=1)
    task_kind: str = Field(default="plain_language_summary", min_length=1, max_length=80)


class EmailPort(Protocol):
    def send(self, request: EmailRequest, *, idempotency_key: str) -> AdapterResult:
        """Send one rendered notification using a stable idempotency key."""


class GoogleCalendarPort(Protocol):
    def upsert_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        """Create or update one calendar projection idempotently."""


class ClinicalLLMPort(Protocol):
    def generate_summary(
        self, request: ClinicalSummaryRequest, *, idempotency_key: str
    ) -> AdapterResult:
        """Generate optional derived content from a server-side source reference."""


# Short alias for callers that do not need to spell out the provider.
CalendarPort = GoogleCalendarPort
