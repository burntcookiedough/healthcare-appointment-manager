"""Stable event-type names understood by the Phase 1 worker."""

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
KNOWN_EVENT_TYPES = EMAIL_EVENT_TYPES | CALENDAR_EVENT_TYPES | LLM_EVENT_TYPES
