"""Deterministic fake adapters used until provider integrations are authorized."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass

from .ports import (
    AdapterResult,
    CalendarRequest,
    ClinicalLLMPort,
    ClinicalSummaryRequest,
    EmailPort,
    EmailRequest,
    GoogleCalendarPort,
)


@dataclass(frozen=True, slots=True)
class AdapterCall:
    """Safe test trace of one adapter invocation."""

    idempotency_key: str
    request: object


class _DeterministicAdapter:
    def __init__(self, outcomes: Iterable[AdapterResult] | None = None) -> None:
        self._outcomes = deque(outcomes or ())
        self.calls: list[AdapterCall] = []
        self._call_number = 0

    def _result_for_next_call(self, *, provider_name: str) -> AdapterResult:
        self._call_number += 1
        if self._outcomes:
            return self._outcomes.popleft()
        return AdapterResult.success(provider_reference=f"fake-{provider_name}-{self._call_number}")


class DeterministicFakeEmailAdapter(_DeterministicAdapter, EmailPort):
    """Fake email adapter with a caller-controlled result sequence."""

    def send(self, request: EmailRequest, *, idempotency_key: str) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        return self._result_for_next_call(provider_name="email")


class DeterministicFakeGoogleCalendarAdapter(_DeterministicAdapter, GoogleCalendarPort):
    """Fake Google Calendar adapter with no network or OAuth behavior."""

    def upsert_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        return self._result_for_next_call(provider_name="calendar")


class DeterministicFakeClinicalLLMAdapter(_DeterministicAdapter, ClinicalLLMPort):
    """Fake clinical LLM adapter that returns normalized outcomes only."""

    def generate_summary(
        self, request: ClinicalSummaryRequest, *, idempotency_key: str
    ) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        return self._result_for_next_call(provider_name="llm")


# Friendly aliases for test and integration code.
FakeEmailAdapter = DeterministicFakeEmailAdapter
FakeGoogleCalendarAdapter = DeterministicFakeGoogleCalendarAdapter
FakeClinicalLLMAdapter = DeterministicFakeClinicalLLMAdapter
