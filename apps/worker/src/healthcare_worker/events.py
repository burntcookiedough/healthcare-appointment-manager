"""Stable event-type names understood by the Phase 1 worker."""

from collections.abc import Iterable
from enum import StrEnum


class EventType(StrEnum):
    """Integration-oriented outbox events.

    Domain transactions may emit more specific events later.  They should keep
    the same envelope and explicitly map to one of these provider operations rather
    than putting provider payloads or clinical text in the queue.
    """

    EMAIL_NOTIFICATION = "email.notification"
    EMAIL_SEND = "email.send"
    APPOINTMENT_REMINDER = "appointment.reminder"
    MEDICATION_REMINDER = "medication.reminder"
    CALENDAR_SYNC = "calendar.sync"
    GOOGLE_CALENDAR_SYNC = "google_calendar.sync"
    LLM_SUMMARY = "llm.summary"
    CLINICAL_LLM_SUMMARY = "clinical.llm.summary"
    # API outbox names are retained as first-class contract values.  Handlers
    # translate them to the stable provider operations below.
    APPOINTMENT_CONFIRMED = "appointment.confirmed"
    APPOINTMENT_CALENDAR_SYNC = "appointment.calendar_sync"


EMAIL_EVENT_TYPES = frozenset(
    {
        EventType.EMAIL_NOTIFICATION.value,
        EventType.EMAIL_SEND.value,
        EventType.APPOINTMENT_REMINDER.value,
        EventType.MEDICATION_REMINDER.value,
    }
)
CALENDAR_EVENT_TYPES = frozenset(
    {EventType.CALENDAR_SYNC.value, EventType.GOOGLE_CALENDAR_SYNC.value}
)
LLM_EVENT_TYPES = frozenset({EventType.LLM_SUMMARY.value, EventType.CLINICAL_LLM_SUMMARY.value})
API_EVENT_TYPES = frozenset(
    {
        EventType.APPOINTMENT_CONFIRMED.value,
        EventType.APPOINTMENT_CALENDAR_SYNC.value,
    }
)
KNOWN_EVENT_TYPES = EMAIL_EVENT_TYPES | CALENDAR_EVENT_TYPES | LLM_EVENT_TYPES | API_EVENT_TYPES

# This is deliberately explicit.  A newly emitted API event must be added here
# and given a handler/contract test instead of silently becoming a dead letter.
API_EVENT_TRANSLATIONS: dict[str, frozenset[str]] = {
    EventType.APPOINTMENT_CONFIRMED.value: frozenset(
        {EventType.EMAIL_NOTIFICATION.value, EventType.CALENDAR_SYNC.value}
    ),
    EventType.APPOINTMENT_CALENDAR_SYNC.value: frozenset({EventType.CALENDAR_SYNC.value}),
}


def translated_event_types(event_type: str) -> frozenset[str]:
    """Return stable provider operations for an API or already-stable event."""

    return API_EVENT_TRANSLATIONS.get(event_type, frozenset({event_type}))


def assert_supported_api_events(event_types: Iterable[str]) -> None:
    """Fail fast in contract tests when the API adds an unsupported event name."""

    unknown = set(event_types) - set(API_EVENT_TRANSLATIONS)
    if unknown:
        raise ValueError("unsupported API event types: " + ", ".join(sorted(unknown)))
