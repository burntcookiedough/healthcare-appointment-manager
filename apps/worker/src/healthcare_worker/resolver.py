"""Async PostgreSQL-backed trusted-reference resolution for provider adapters.

The outbox envelope deliberately contains only opaque identifiers.  This module
resolves the minimum source data after a row is claimed, using the same asyncpg
pool as the durable outbox store.  ``bind`` loads data for one envelope and keeps
it in a task-local context so the existing synchronous provider ports do not block
the poller's event loop or share PHI between concurrent claims.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Any
from uuid import UUID

from .envelope import EventEnvelope
from .events import CALENDAR_EVENT_TYPES, EMAIL_EVENT_TYPES, LLM_EVENT_TYPES
from .ports import (
    CalendarRequest,
    ClinicalSummaryRequest,
    EmailContent,
    EmailRequest,
    OAuthCredentials,
    SummarySource,
    TrustedDataResolutionError,
    TrustedDataResolver,
)

# These queries intentionally select only the fields needed by the adapter.  Every
# lookup is keyed by an opaque UUID, joins the owning domain row, and has a LIMIT.
EMAIL_REFERENCE_SQL = """
SELECT 1
FROM patient_profiles AS profile
JOIN actors AS actor ON actor.id = profile.actor_id
WHERE profile.actor_id = $1
  AND actor.role = 'patient'
  AND actor.is_active
LIMIT 1
"""

CALENDAR_EVENT_REFERENCE_SQL = """
SELECT operation.provider_reference,
       operation.outbox_event_id,
       event.payload->>'provider_event_reference' AS payload_provider_reference,
       event.payload->>'action' AS action
FROM integration_operations AS operation
JOIN outbox_events AS event ON event.id = operation.outbox_event_id
JOIN appointments AS appointment ON appointment.id = operation.appointment_id
WHERE operation.appointment_id = $1
  AND event.appointment_id = $1
  AND operation.channel = 'calendar'
ORDER BY operation.updated_at DESC, operation.created_at DESC, operation.id DESC
LIMIT 1
"""

SUMMARY_SYMPTOM_SQL = """
SELECT symptom.id, symptom.version, symptom.symptoms_text
FROM symptom_versions AS symptom
JOIN appointments AS appointment ON appointment.id = symptom.appointment_id
WHERE symptom.id = $1
  AND symptom.version = $2
  AND char_length(symptom.symptoms_text) BETWEEN 1 AND 500000
LIMIT 1
"""

SUMMARY_VISIT_SQL = """
SELECT visit.id AS visit_id,
       visit.version AS visit_version,
       note.version AS note_version,
       note.notes_text
FROM visits AS visit
JOIN appointments AS appointment ON appointment.id = visit.appointment_id
JOIN LATERAL (
    SELECT note_version.version, note_version.notes_text
    FROM visit_note_versions AS note_version
    WHERE note_version.visit_id = visit.id
    ORDER BY note_version.version DESC, note_version.id DESC
    LIMIT 1
) AS note ON TRUE
WHERE visit.id = $1
  AND visit.version = $2
  AND char_length(note.notes_text) BETWEEN 1 AND 500000
LIMIT 1
"""

SUMMARY_PRESCRIPTION_ITEMS_SQL = """
SELECT item.medication_name,
       item.dosage,
       item.route,
       item.frequency,
       item.start_date,
       item.end_date,
       item.duration_days,
       item.instructions
FROM prescriptions AS prescription
JOIN visits AS visit ON visit.id = prescription.visit_id
JOIN appointments AS appointment ON appointment.id = visit.appointment_id
JOIN prescription_items AS item ON item.prescription_id = prescription.id
WHERE prescription.visit_id = $1
ORDER BY item.created_at, item.id
LIMIT 101
"""

PRESCRIPTION_SCHEDULE_SQL = """
SELECT prescription.id AS prescription_id,
       prescription.version AS prescription_version,
       item.id AS item_id,
       item.medication_name,
       item.dosage,
       item.route,
       item.frequency,
       item.start_date,
       item.end_date,
       item.duration_days,
       item.instructions,
       COALESCE(preference.timezone, profile.timezone, 'UTC') AS time_zone
FROM prescriptions AS prescription
JOIN visits AS visit ON visit.id = prescription.visit_id
JOIN appointments AS appointment ON appointment.id = visit.appointment_id
JOIN patient_profiles AS profile ON profile.actor_id = appointment.patient_id
JOIN prescription_items AS item ON item.prescription_id = prescription.id
LEFT JOIN reminder_preferences AS preference
       ON preference.patient_id = appointment.patient_id
WHERE prescription.id = $1
  AND prescription.version = $2
ORDER BY item.created_at, item.id
LIMIT 101
"""


class _SourceShapeError(ValueError):
    """A permanent trusted-row shape problem, distinct from driver failures."""


@dataclass(slots=True)
class _BoundResolution:
    """Task-local values and normalized failures for one claimed envelope."""

    email_reference: str | None = None
    email_reference_exists: bool = False
    email_error: tuple[str, bool] | None = None
    calendar_appointment_id: UUID | None = None
    calendar_event_reference: str | None = None
    calendar_event_error: tuple[str, bool] | None = None
    summary: SummarySource | None = None
    summary_task_kind: str | None = None
    summary_error: tuple[str, bool] | None = None
    prescriptions: dict[tuple[UUID, int], object] = field(default_factory=dict)
    prescription_error: tuple[str, bool] | None = None


def _uuid_value(value: object) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return UUID(value)
    except (TypeError, ValueError, AttributeError):
        return None


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return None
    return value


def _text_value(value: object, *, max_length: int = 512) -> str | None:
    if not isinstance(value, str) or not value or len(value) > max_length:
        return None
    if any(character in value for character in "\r\n"):
        return None
    return value


def _json_default(value: object) -> str:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return str(value)


def _row_value(row: Mapping[str, Any], key: str) -> object:
    getter = getattr(row, "get", None)
    if not callable(getter):
        raise _SourceShapeError("trusted source row is not mapping-shaped")
    try:
        return getter(key)
    except Exception as error:
        raise _SourceShapeError("trusted source row cannot be read") from error


class PostgresTrustedDataResolver(TrustedDataResolver):
    """Resolve trusted references from the API's PostgreSQL schema.

    The resolver shares the outbox pool and therefore has no independent socket
    or close operation.  Callers must use :meth:`bind` around one envelope before
    invoking the synchronous adapter ports.  Context-local state is reset even
    when a handler or provider raises.
    """

    def __init__(self, pool: Any) -> None:
        self._pool = pool
        self._bound: ContextVar[_BoundResolution | None] = ContextVar(
            "healthcare_worker_trusted_resolution", default=None
        )

    @asynccontextmanager
    async def bind(self, envelope: EventEnvelope) -> AsyncIterator[PostgresTrustedDataResolver]:
        """Load only the references required by ``envelope`` and bind them locally."""

        bound = await self._load_for_event(envelope)
        token = self._bound.set(bound)
        try:
            yield self
        finally:
            self._bound.reset(token)

    async def _load_for_event(self, envelope: EventEnvelope) -> _BoundResolution:
        bound = _BoundResolution()
        payload = envelope.safe_payload.as_dict()
        needs_email = envelope.event_type in EMAIL_EVENT_TYPES or envelope.event_type in {
            "appointment.confirmed",
        }
        needs_calendar = envelope.event_type in CALENDAR_EVENT_TYPES or envelope.event_type in {
            "appointment.confirmed",
            "appointment.calendar_sync",
        }
        needs_summary = envelope.event_type in LLM_EVENT_TYPES
        needs_prescription = envelope.event_type == "medication.reminder"

        email_reference = _text_value(
            payload.get("recipient_reference") or payload.get("recipient_ref"), max_length=128
        )
        email_uuid = _uuid_value(email_reference)
        if email_uuid is None:
            needs_email = False

        action = payload.get("action") or payload.get("operation")
        if action is None:
            label = payload.get("event_label")
            if isinstance(label, str) and "cancellation" in label.casefold():
                action = "delete"
        calendar_uuid = _uuid_value(payload.get("appointment_id"))
        needs_calendar_reference = (
            needs_calendar
            and isinstance(action, str)
            and action
            in {
                "update",
                "delete",
            }
        )
        if needs_calendar_reference and calendar_uuid is None:
            needs_calendar_reference = False

        source_uuid = _uuid_value(
            payload.get("source_record_reference")
            or payload.get("source_reference")
            or payload.get("source_ref")
        )
        source_version = _positive_int(payload.get("source_version"))
        task_kind = payload.get("task_kind", "plain_language_summary")
        if task_kind == "pre_visit_brief":
            task_kind = "pre_visit"
        elif task_kind == "post_visit_summary":
            task_kind = "post_visit"
        if not isinstance(task_kind, str) or source_uuid is None or source_version is None:
            needs_summary = False

        prescription_uuid = _uuid_value(
            payload.get("prescription_id") or payload.get("prescription_ref")
        )
        prescription_version = _positive_int(
            payload.get("prescription_version", payload.get("version", 1))
        )
        if prescription_uuid is None or prescription_version is None:
            needs_prescription = False

        needs_database = (
            needs_email or needs_calendar_reference or needs_summary or needs_prescription
        )
        if not needs_database:
            return bound

        try:
            async with self._pool.acquire() as connection:
                if needs_email and email_uuid is not None:
                    try:
                        row = await connection.fetchrow(EMAIL_REFERENCE_SQL, email_uuid)
                        bound.email_reference = str(email_uuid)
                        bound.email_reference_exists = row is not None
                        # The schema proves patient ownership but has no contact or
                        # template store, so a known patient cannot be sent fabricated mail.
                        if row is not None:
                            bound.email_error = ("EMAIL_RECIPIENT_UNAVAILABLE", False)
                    except _SourceShapeError:
                        bound.email_error = ("EMAIL_REFERENCE_ERROR", False)
                    except Exception:
                        bound.email_error = ("EMAIL_REFERENCE_ERROR", True)

                if needs_calendar_reference and calendar_uuid is not None:
                    try:
                        bound.calendar_appointment_id = calendar_uuid
                        row = await connection.fetchrow(CALENDAR_EVENT_REFERENCE_SQL, calendar_uuid)
                        provided_reference = _text_value(
                            payload.get("provider_event_reference")
                            or payload.get("calendar_event_id"),
                            max_length=256,
                        )
                        candidate = self._calendar_reference_from_row(row)
                        if row is None:
                            if provided_reference is not None:
                                bound.calendar_event_error = (
                                    "CALENDAR_EVENT_REFERENCE_UNVERIFIED",
                                    False,
                                )
                        elif candidate is None:
                            bound.calendar_event_error = (
                                "CALENDAR_EVENT_REFERENCE_MISSING",
                                False,
                            )
                        elif provided_reference is not None and provided_reference != candidate:
                            bound.calendar_event_error = (
                                "CALENDAR_EVENT_REFERENCE_MISMATCH",
                                False,
                            )
                        else:
                            bound.calendar_event_reference = candidate
                    except _SourceShapeError:
                        bound.calendar_event_error = ("CALENDAR_REFERENCE_ERROR", False)
                    except Exception:
                        bound.calendar_event_error = ("CALENDAR_REFERENCE_ERROR", True)

                if needs_summary and source_uuid is not None and source_version is not None:
                    try:
                        assert isinstance(task_kind, str)
                        bound.summary_task_kind = task_kind
                        if task_kind == "pre_visit":
                            row = await connection.fetchrow(
                                SUMMARY_SYMPTOM_SQL, source_uuid, source_version
                            )
                            if row is not None:
                                source_text = _row_value(row, "symptoms_text")
                                if not isinstance(source_text, str):
                                    raise _SourceShapeError("symptom source is unavailable")
                                try:
                                    bound.summary = SummarySource(
                                        source_reference=source_uuid,
                                        source_version=source_version,
                                        source_text=source_text,
                                    )
                                except Exception as error:
                                    raise _SourceShapeError("symptom source is invalid") from error
                        elif task_kind in {"post_visit", "plain_language_summary"}:
                            row = await connection.fetchrow(
                                SUMMARY_VISIT_SQL, source_uuid, source_version
                            )
                            if row is not None:
                                note_text = _row_value(row, "notes_text")
                                item_rows = await connection.fetch(
                                    SUMMARY_PRESCRIPTION_ITEMS_SQL, source_uuid
                                )
                                if not isinstance(item_rows, list):
                                    raise _SourceShapeError("prescription source rows are invalid")
                                if len(item_rows) > 100:
                                    bound.summary_error = ("SUMMARY_SOURCE_TOO_LARGE", False)
                                else:
                                    source_text = self._visit_source_text(note_text, item_rows)
                                    try:
                                        bound.summary = SummarySource(
                                            source_reference=source_uuid,
                                            source_version=source_version,
                                            source_text=source_text,
                                        )
                                    except Exception as error:
                                        raise _SourceShapeError(
                                            "visit source is invalid"
                                        ) from error
                    except _SourceShapeError:
                        bound.summary_error = ("SUMMARY_SOURCE_ERROR", False)
                    except Exception:
                        bound.summary_error = ("SUMMARY_SOURCE_ERROR", True)

                if (
                    needs_prescription
                    and prescription_uuid is not None
                    and prescription_version is not None
                ):
                    try:
                        rows = await connection.fetch(
                            PRESCRIPTION_SCHEDULE_SQL, prescription_uuid, prescription_version
                        )
                        if not isinstance(rows, list):
                            raise _SourceShapeError("prescription schedule rows are invalid")
                        if len(rows) > 100:
                            bound.prescription_error = ("PRESCRIPTION_SOURCE_TOO_LARGE", False)
                        elif rows:
                            schedules = tuple(
                                self._prescription_schedule_from_row(row) for row in rows
                            )
                            bound.prescriptions[(prescription_uuid, prescription_version)] = (
                                schedules[0] if len(schedules) == 1 else schedules
                            )
                    except _SourceShapeError:
                        bound.prescription_error = ("PRESCRIPTION_REFERENCE_ERROR", False)
                    except Exception:
                        bound.prescription_error = ("PRESCRIPTION_REFERENCE_ERROR", True)
        except Exception:
            # Provider adapters receive only normalized retry codes; the database
            # driver exception is intentionally never logged or persisted.
            if needs_email and bound.email_error is None:
                bound.email_error = ("EMAIL_REFERENCE_ERROR", True)
            if needs_calendar_reference and bound.calendar_event_error is None:
                bound.calendar_event_error = ("CALENDAR_REFERENCE_ERROR", True)
            if needs_summary and bound.summary_error is None:
                bound.summary_error = ("SUMMARY_SOURCE_ERROR", True)
            if needs_prescription and bound.prescription_error is None:
                bound.prescription_error = ("PRESCRIPTION_REFERENCE_ERROR", True)
        return bound

    @staticmethod
    def _calendar_reference_from_row(row: Mapping[str, Any] | None) -> str | None:
        if row is None:
            return None
        candidate = _text_value(_row_value(row, "provider_reference"), max_length=256)
        if candidate is None:
            candidate = _text_value(_row_value(row, "payload_provider_reference"), max_length=256)
        if candidate is None:
            action = _row_value(row, "action")
            if action not in {None, "create"}:
                return None
            event_id = _row_value(row, "outbox_event_id")
            if isinstance(event_id, UUID):
                candidate = hashlib.sha256(str(event_id).encode("utf-8")).hexdigest()[:32]
        return candidate

    @staticmethod
    def _visit_source_text(note_text: object, item_rows: list[Mapping[str, Any]]) -> str:
        if not isinstance(note_text, str):
            raise _SourceShapeError("visit note source is unavailable")
        if not item_rows:
            return note_text
        items: list[dict[str, object]] = []
        for row in item_rows:
            items.append(
                {
                    "medication_name": _row_value(row, "medication_name"),
                    "dosage": _row_value(row, "dosage"),
                    "route": _row_value(row, "route"),
                    "frequency": _row_value(row, "frequency"),
                    "start_date": _row_value(row, "start_date"),
                    "end_date": _row_value(row, "end_date"),
                    "duration_days": _row_value(row, "duration_days"),
                    "instructions": _row_value(row, "instructions"),
                }
            )
        return json.dumps(
            {"clinician_note": note_text, "prescription_items": items},
            default=_json_default,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )

    @staticmethod
    def _prescription_schedule_from_row(row: Mapping[str, Any]) -> dict[str, object]:
        prescription_id = _row_value(row, "prescription_id")
        item_id = _row_value(row, "item_id")
        version = _row_value(row, "prescription_version")
        if not isinstance(prescription_id, UUID) or not isinstance(item_id, UUID):
            raise _SourceShapeError("prescription reference is invalid")
        if not isinstance(version, int) or version < 1:
            raise _SourceShapeError("prescription version is invalid")
        return {
            "prescription_id": prescription_id,
            "prescription_version": version,
            "prescription_item_id": item_id,
            "medication_reference": str(item_id),
            "medication_name": _row_value(row, "medication_name"),
            "dosage_amount": _row_value(row, "dosage"),
            "route": _row_value(row, "route"),
            "patient_instructions": _row_value(row, "instructions"),
            "start_date": _row_value(row, "start_date"),
            "end_date": _row_value(row, "end_date"),
            "duration_days": _row_value(row, "duration_days"),
            "frequency": _row_value(row, "frequency"),
            "time_zone": _row_value(row, "time_zone") or "UTC",
        }

    @staticmethod
    def _raise_status(status: tuple[str, bool] | None) -> None:
        if status is not None:
            raise TrustedDataResolutionError(status[0], retryable=status[1])

    def _current(self) -> _BoundResolution:
        current = self._bound.get()
        if current is None:
            raise TrustedDataResolutionError("RESOLVER_CONTEXT_MISSING")
        return current

    def resolve_email(self, request: EmailRequest) -> EmailContent | None:
        current = self._current()
        self._raise_status(current.email_error)
        if request.recipient_reference is None:
            return None
        if current.email_reference != request.recipient_reference:
            return None
        # No email address or approved template content exists in the API schema.
        return None

    def resolve_calendar_credentials(self, request: CalendarRequest) -> OAuthCredentials | None:
        del request
        # The reviewed migrations contain no refresh/access-token store.  Never
        # treat an actor subject, provider reference, or outbox value as a token.
        raise TrustedDataResolutionError("CALENDAR_CREDENTIALS_UNAVAILABLE")

    def resolve_calendar_event_reference(self, request: CalendarRequest) -> str | None:
        current = self._current()
        self._raise_status(current.calendar_event_error)
        if request.appointment_id != current.calendar_appointment_id:
            raise TrustedDataResolutionError("CALENDAR_EVENT_REFERENCE_MISMATCH")
        return current.calendar_event_reference

    def validate_calendar_event_reference(self, request: CalendarRequest) -> str | None:
        """Validate an event reference already present in a payload, if any."""

        current = self._current()
        self._raise_status(current.calendar_event_error)
        if request.appointment_id != current.calendar_appointment_id:
            raise TrustedDataResolutionError("CALENDAR_EVENT_REFERENCE_MISMATCH")
        trusted = current.calendar_event_reference
        if trusted is None:
            return None
        if (
            request.provider_event_reference is not None
            and request.provider_event_reference != trusted
        ):
            raise TrustedDataResolutionError("CALENDAR_EVENT_REFERENCE_MISMATCH")
        return trusted

    def resolve_summary_source(self, request: ClinicalSummaryRequest) -> SummarySource | None:
        current = self._current()
        self._raise_status(current.summary_error)
        if request.source_record_reference is None:
            return None
        if current.summary is None:
            return None
        if current.summary.source_reference != request.source_record_reference:
            return None
        if request.task_kind != current.summary_task_kind:
            raise TrustedDataResolutionError("SUMMARY_SOURCE_MISMATCH")
        if request.source_version != current.summary.source_version:
            return None
        return current.summary

    def resolve_prescription_schedule(
        self, prescription_id: UUID, version: int | None
    ) -> object | None:
        current = self._current()
        self._raise_status(current.prescription_error)
        if version is None:
            return None
        return current.prescriptions.get((prescription_id, version))


# Descriptive alias for integration code that uses the shorter name.
PostgresDataResolver = PostgresTrustedDataResolver
