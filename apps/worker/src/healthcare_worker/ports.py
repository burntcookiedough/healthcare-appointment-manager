"""Provider-neutral ports, trusted-reference resolution, and safe request models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Protocol
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from .results import ProcessingOutcome


class AdapterResult(BaseModel):
    """Normalized provider result with no provider exception text."""

    model_config = ConfigDict(extra="forbid")

    outcome: ProcessingOutcome
    provider_reference: str | None = Field(default=None, max_length=200)
    error_code: str | None = Field(
        default=None,
        max_length=80,
        pattern=r"^[A-Za-z0-9_.:-]+$",
    )
    retry_after_seconds: float | None = Field(default=None, ge=0, le=3600)
    # Structured LLM output is persisted through a repository by the handler;
    # it is never logged or put back into the outbox payload.
    output: dict[str, Any] | None = None
    metadata: dict[str, str] | None = None

    @property
    def is_success(self) -> bool:
        return self.outcome is ProcessingOutcome.SUCCEEDED

    @property
    def is_retryable(self) -> bool:
        return self.outcome is ProcessingOutcome.RETRYABLE_FAILURE

    @classmethod
    def success(
        cls,
        provider_reference: str | None = None,
        *,
        output: dict[str, Any] | None = None,
        metadata: dict[str, str] | None = None,
    ) -> AdapterResult:
        return cls(
            outcome=ProcessingOutcome.SUCCEEDED,
            provider_reference=provider_reference,
            output=output,
            metadata=metadata,
        )

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

    template_key: str = Field(
        default="appointment_update",
        min_length=1,
        max_length=80,
        validation_alias=AliasChoices("template_key", "notification_key"),
    )
    recipient_reference: str | None = Field(
        default=None,
        max_length=128,
        validation_alias=AliasChoices("recipient_reference", "recipient_ref"),
    )
    appointment_id: UUID | None = None
    prescription_id: UUID | None = None
    occurrence_id: UUID | None = None
    notification_reference: str | None = Field(default=None, max_length=128)
    locale: str = Field(default="en", min_length=2, max_length=16)


class CalendarRequest(BaseModel):
    """Minimum appointment projection fields; no clinical text or free-form body."""

    model_config = ConfigDict(extra="forbid")

    appointment_id: UUID | None = None
    doctor_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    time_zone: str | None = Field(default=None, max_length=64)
    event_label: str = Field(default="Healthcare appointment", max_length=80)
    action: Literal["create", "update", "delete"] = Field(
        default="create",
        validation_alias=AliasChoices("action", "operation"),
    )
    calendar_reference: str | None = Field(
        default=None,
        max_length=128,
        validation_alias=AliasChoices("calendar_reference", "calendar_id"),
    )
    provider_event_reference: str | None = Field(
        default=None,
        max_length=256,
        validation_alias=AliasChoices("provider_event_reference", "calendar_event_id"),
    )
    credential_reference: str | None = Field(default=None, max_length=128)


class ClinicalSummaryRequest(BaseModel):
    """Reference-only LLM request; source text is fetched behind a later port."""

    model_config = ConfigDict(extra="forbid")

    source_record_reference: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("source_record_reference", "source_reference", "source_ref"),
    )
    source_version: int | None = Field(default=None, ge=1)
    task_kind: Literal["pre_visit", "post_visit", "plain_language_summary"] = (
        "plain_language_summary"
    )
    prompt_version: str = Field(default="clinical.v1", min_length=1, max_length=64)
    schema_version: str = Field(default="clinical.v1", min_length=1, max_length=64)
    credential_reference: str | None = Field(default=None, max_length=128)


class EmailContent(BaseModel):
    """Sensitive content resolved at execution time, never accepted in an event."""

    model_config = ConfigDict(extra="forbid")

    recipient_email: str = Field(
        min_length=3,
        max_length=320,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    )
    subject: str = Field(min_length=1, max_length=200)
    text_body: str = Field(min_length=1, max_length=100_000)
    html_body: str | None = Field(default=None, max_length=300_000)


class OAuthCredentials(BaseModel):
    """Short-lived provider credentials obtained from a trusted server-side port."""

    model_config = ConfigDict(extra="forbid")

    access_token: str = Field(
        min_length=1,
        max_length=10_000,
        pattern=r"^[^\r\n]+$",
        repr=False,
    )
    token_type: str = Field(
        default="Bearer",
        min_length=1,
        max_length=32,
        pattern=r"^[A-Za-z][A-Za-z0-9_-]*$",
    )


class SummarySource(BaseModel):
    """Source text fetched by reference under the worker's trusted DB boundary."""

    model_config = ConfigDict(extra="forbid")

    source_reference: UUID
    source_version: int = Field(ge=1)
    source_text: str = Field(min_length=1, max_length=500_000, repr=False)


class TrustedDataResolver(Protocol):
    """Resolve PHI and credentials only after a validated event is claimed."""

    def resolve_email(self, request: EmailRequest) -> EmailContent | None:
        """Resolve a recipient and rendered template from an internal reference."""

    def resolve_calendar_credentials(self, request: CalendarRequest) -> OAuthCredentials | None:
        """Resolve an access token without placing it in an event or log."""

    def resolve_summary_source(self, request: ClinicalSummaryRequest) -> SummarySource | None:
        """Resolve source clinical text from a trusted reference."""

    def resolve_prescription_schedule(
        self, prescription_id: UUID, version: int | None
    ) -> object | None:
        """Resolve structured prescription fields for reminder generation."""


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


class SummaryRepository(Protocol):
    """Persist validated derived output separately from immutable source records."""

    def persist_summary(self, record: object) -> None:
        """Persist a generated artifact or a safe failure state."""


# Short alias for callers that do not need to spell out the provider.
CalendarPort = GoogleCalendarPort
