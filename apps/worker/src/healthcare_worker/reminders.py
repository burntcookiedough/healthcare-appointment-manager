"""Timezone-aware, restart-safe medication reminder scheduling."""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import suppress
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Protocol
from uuid import NAMESPACE_URL, UUID, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator

from .ports import AdapterResult, EmailPort, EmailRequest, TrustedDataResolver


class PrescriptionSchedule(BaseModel):
    """Only reviewed structured fields participate in reminder generation."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    prescription_id: UUID
    prescription_version: int = Field(
        default=1,
        ge=1,
        validation_alias=AliasChoices("prescription_version", "version"),
    )
    # ``prescription_id`` versions the reviewed prescription envelope; this
    # stable item identity is the foreign key used by PostgreSQL reminder rows.
    prescription_item_id: UUID | None = None
    medication_reference: str = Field(min_length=1, max_length=128)
    medication_name: str | None = Field(default=None, min_length=1, max_length=200)
    dosage_amount: str | None = Field(default=None, min_length=1, max_length=120)
    route: str | None = Field(default=None, min_length=1, max_length=80)
    patient_instructions: str | None = Field(default=None, min_length=1, max_length=2_000)
    start_date: date
    end_date: date | None = None
    duration_days: int | None = Field(default=None, ge=1, le=3_650)
    frequency: str = Field(min_length=1, max_length=64)
    times_of_day: list[time] = Field(
        default_factory=list,
        validation_alias=AliasChoices("times_of_day", "local_times", "times"),
    )
    interval_hours: int | None = Field(default=None, ge=1, le=24)
    time_zone: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def infer_item_identity(self) -> PrescriptionSchedule:
        """Accept legacy references while retaining UUID identity when present."""

        if self.prescription_item_id is None:
            with suppress(TypeError, ValueError):
                self.prescription_item_id = UUID(self.medication_reference)
            # Local deterministic fixtures may use a non-UUID reference; the
            # PostgreSQL store rejects those schedules before writing rows.
        return self

    @field_validator("times_of_day")
    @classmethod
    def normalize_times(cls, value: list[time]) -> list[time]:
        return sorted(set(value))

    def effective_end_date(self) -> date | None:
        if self.end_date is not None and self.duration_days is not None:
            return min(self.end_date, self.start_date + timedelta(days=self.duration_days - 1))
        if self.end_date is not None:
            return self.end_date
        if self.duration_days is not None:
            return self.start_date + timedelta(days=self.duration_days - 1)
        return None

    def local_times(self) -> tuple[time, ...]:
        if self.times_of_day:
            return tuple(self.times_of_day)
        normalized = self.frequency.casefold().replace("-", "_").replace(" ", "_")
        defaults: dict[str, tuple[time, ...]] = {
            "daily": (time(9, 0),),
            "once_daily": (time(9, 0),),
            "qd": (time(9, 0),),
            "twice_daily": (time(9, 0), time(21, 0)),
            "two_times_daily": (time(9, 0), time(21, 0)),
            "bid": (time(9, 0), time(21, 0)),
            "three_times_daily": (time(8, 0), time(14, 0), time(20, 0)),
            "tid": (time(8, 0), time(14, 0), time(20, 0)),
            "four_times_daily": (time(6, 0), time(12, 0), time(18, 0), time(23, 0)),
            "qid": (time(6, 0), time(12, 0), time(18, 0), time(23, 0)),
            "as_needed": (),
            "prn": (),
        }
        if normalized in defaults:
            return defaults[normalized]
        if normalized.startswith("every_") and normalized.endswith("_hours"):
            try:
                interval = int(normalized.removeprefix("every_").removesuffix("_hours"))
            except ValueError as error:
                raise ValueError("frequency must be structured and recognized") from error
            if not 1 <= interval <= 24:
                raise ValueError("interval frequency must be between 1 and 24 hours")
            first = time(8, 0)
            return tuple(
                (datetime.combine(date.min, first) + timedelta(hours=offset)).time()
                for offset in range(0, 24, interval)
            )
        if self.interval_hours is not None:
            first = time(8, 0)
            return tuple(
                (datetime.combine(date.min, first) + timedelta(hours=offset)).time()
                for offset in range(0, 24, self.interval_hours)
            )
        raise ValueError("frequency must include explicit local times or a known structured value")


class ReminderOccurrence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    occurrence_id: UUID
    prescription_id: UUID
    prescription_version: int = Field(ge=1)
    local_date: date
    local_time: time
    time_zone: str
    due_at: datetime
    prescription_item_id: UUID | None = None


def _resolve_local_datetime(local_date: date, local_time: time, zone: ZoneInfo) -> datetime:
    """Resolve DST folds/gaps deterministically (fold 0, shift gaps forward)."""

    naive = datetime.combine(local_date, local_time)
    candidate = naive.replace(tzinfo=zone, fold=0)
    round_trip = candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None)
    if round_trip == naive:
        return candidate
    # A spring-forward gap has no exact instant.  Shift to the first valid wall
    # clock minute, bounded so malformed zones cannot create an unbounded loop.
    for minutes in range(1, 181):
        shifted = naive + timedelta(minutes=minutes)
        candidate = shifted.replace(tzinfo=zone, fold=0)
        if candidate.astimezone(UTC).astimezone(zone).replace(tzinfo=None) == shifted:
            return candidate
    raise ValueError("unable to resolve local reminder time")


def generate_medication_occurrences(
    schedule: PrescriptionSchedule | Mapping[str, Any],
    *,
    until_date: date | None = None,
    from_date: date | None = None,
    max_days: int = 366,
) -> list[ReminderOccurrence]:
    """Generate deterministic UTC occurrences from structured prescription fields."""

    resolved = (
        schedule
        if isinstance(schedule, PrescriptionSchedule)
        else PrescriptionSchedule.model_validate(schedule)
    )
    try:
        zone = ZoneInfo(resolved.time_zone)
    except ZoneInfoNotFoundError as error:
        raise ValueError("invalid prescription time zone") from error
    start = max(resolved.start_date, from_date or resolved.start_date)
    end = resolved.effective_end_date() or (start + timedelta(days=max_days - 1))
    if until_date is not None:
        end = min(end, until_date)
    end = min(end, start + timedelta(days=max_days - 1))
    if end < start:
        return []
    times = resolved.local_times()
    occurrences: list[ReminderOccurrence] = []
    current = start
    while current <= end:
        for local_time in times:
            due_local = _resolve_local_datetime(current, local_time, zone)
            stable_key = (
                f"{resolved.prescription_item_id or resolved.medication_reference}:"
                f"{resolved.prescription_version}:"
                f"{current.isoformat()}:{local_time.isoformat()}:{resolved.time_zone}"
            )
            occurrences.append(
                ReminderOccurrence(
                    occurrence_id=uuid5(NAMESPACE_URL, stable_key),
                    prescription_id=resolved.prescription_id,
                    prescription_version=resolved.prescription_version,
                    local_date=current,
                    local_time=local_time,
                    time_zone=resolved.time_zone,
                    due_at=due_local.astimezone(UTC),
                    prescription_item_id=resolved.prescription_item_id,
                )
            )
        current += timedelta(days=1)
    return occurrences


# Common aliases used by integration code.
generate_occurrences = generate_medication_occurrences
medication_reminder_occurrences = generate_medication_occurrences


class ReminderOccurrenceStore(Protocol):
    def upsert(self, occurrence: ReminderOccurrence) -> bool:
        """Insert once; return false when the deterministic occurrence already exists."""

    def mark_sent(self, occurrence_id: UUID) -> bool:
        """Mark sent idempotently and return whether this call changed state."""

    def is_sent(self, occurrence_id: UUID) -> bool:
        """Read the durable sent fence."""

    def is_cancelled(self, occurrence_id: UUID) -> bool:
        """Read the durable cancellation fence before contacting a provider."""

    def cancel_superseded(self, prescription_id: UUID, keep_version: int) -> int:
        """Cancel unsent occurrences from older prescription versions."""


class InMemoryReminderOccurrenceStore:
    """Deterministic restart-safe semantics model for focused tests."""

    def __init__(self) -> None:
        self.occurrences: dict[UUID, ReminderOccurrence] = {}
        self.sent: set[UUID] = set()
        self.cancelled: set[UUID] = set()

    def upsert(self, occurrence: ReminderOccurrence) -> bool:
        if occurrence.occurrence_id in self.occurrences:
            return False
        self.occurrences[occurrence.occurrence_id] = occurrence
        return True

    def mark_sent(self, occurrence_id: UUID) -> bool:
        if occurrence_id in self.sent:
            return False
        self.sent.add(occurrence_id)
        return True

    def is_sent(self, occurrence_id: UUID) -> bool:
        return occurrence_id in self.sent

    def is_cancelled(self, occurrence_id: UUID) -> bool:
        return occurrence_id in self.cancelled

    def cancel_superseded(self, prescription_id: UUID, keep_version: int) -> int:
        cancelled = 0
        for occurrence_id, occurrence in self.occurrences.items():
            if (
                occurrence.prescription_id == prescription_id
                and occurrence.prescription_version != keep_version
                and occurrence_id not in self.sent
                and occurrence_id not in self.cancelled
            ):
                self.cancelled.add(occurrence_id)
                cancelled += 1
        return cancelled


class ReminderDatabaseExecutor(Protocol):
    """Small synchronous DB facade; the API owns the concrete connection/pool."""

    def execute(self, statement: str, *parameters: object) -> int | str:
        """Execute one parameterized statement and return affected-row metadata."""

    def fetch_value(self, statement: str, *parameters: object) -> object | None:
        """Fetch one scalar value from a parameterized query."""


class PostgresReminderOccurrenceStore:
    """Durable occurrence fence for the API's reminder-occurrence table.

    The table is intentionally created by the API migration lane.  The worker
    never auto-migrates production data; it only uses parameterized upsert and
    compare-and-set statements once that contract is present.
    """

    UPSERT_SQL = """
    INSERT INTO reminder_occurrences
        (id, prescription_item_id, prescription_version, occurrence_at, status, dedupe_key)
    VALUES ($1, $2, $3, $4, 'pending', $5)
    ON CONFLICT (dedupe_key) DO NOTHING
    """
    MARK_SENT_SQL = """
    UPDATE reminder_occurrences
    SET status = 'sent', sent_at = now()
    WHERE id = $1 AND status = 'pending' AND sent_at IS NULL
    """
    CANCEL_SUPERSEDED_SQL = """
    UPDATE reminder_occurrences AS occurrence
    SET status = 'cancelled'
    FROM prescription_items AS item
    WHERE occurrence.prescription_item_id = item.id
      AND item.prescription_id = $1
      AND occurrence.prescription_version <> $2
      AND occurrence.status NOT IN ('sent', 'cancelled')
    """
    IS_SENT_SQL = """
    SELECT status = 'sent' OR sent_at IS NOT NULL
    FROM reminder_occurrences
    WHERE id = $1
    """
    IS_CANCELLED_SQL = """
    SELECT status = 'cancelled'
    FROM reminder_occurrences
    WHERE id = $1
    """

    def __init__(self, executor: ReminderDatabaseExecutor) -> None:
        self._executor = executor

    def upsert(self, occurrence: ReminderOccurrence) -> bool:
        if occurrence.prescription_item_id is None:
            raise ValueError("prescription item identity is required for PostgreSQL reminders")
        dedupe_key = (
            f"{occurrence.prescription_item_id}:{occurrence.prescription_version}:"
            f"{occurrence.due_at.isoformat()}"
        )
        status = self._executor.execute(
            self.UPSERT_SQL,
            occurrence.occurrence_id,
            occurrence.prescription_item_id,
            occurrence.prescription_version,
            occurrence.due_at,
            dedupe_key,
        )
        return _affected_one(status)

    def mark_sent(self, occurrence_id: UUID) -> bool:
        return _affected_one(self._executor.execute(self.MARK_SENT_SQL, occurrence_id))

    def is_sent(self, occurrence_id: UUID) -> bool:
        return bool(self._executor.fetch_value(self.IS_SENT_SQL, occurrence_id))

    def is_cancelled(self, occurrence_id: UUID) -> bool:
        return bool(self._executor.fetch_value(self.IS_CANCELLED_SQL, occurrence_id))

    def cancel_superseded(self, prescription_id: UUID, keep_version: int) -> int:
        status = self._executor.execute(self.CANCEL_SUPERSEDED_SQL, prescription_id, keep_version)
        if isinstance(status, int):
            return status
        try:
            return int(str(status).split()[-1])
        except (TypeError, ValueError):
            return 0


def _affected_one(status: int | str) -> bool:
    if isinstance(status, int):
        return status == 1
    return str(status).upper().endswith(" 1")


class MedicationReminderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prescription_id: UUID = Field(
        validation_alias=AliasChoices("prescription_id", "prescription_ref")
    )
    prescription_version: int = Field(default=1, ge=1)
    occurrence_id: UUID = Field(validation_alias=AliasChoices("occurrence_id", "occurrence_ref"))
    recipient_reference: str | None = Field(default=None, max_length=128)
    locale: str = Field(default="en", min_length=2, max_length=16)


class MedicationReminderDispatcher:
    """Resolve a prescription schedule and send one deterministic occurrence."""

    def __init__(
        self,
        *,
        resolver: TrustedDataResolver,
        email: EmailPort,
        occurrence_store: ReminderOccurrenceStore,
    ) -> None:
        self._resolver = resolver
        self._email = email
        self._occurrence_store = occurrence_store

    def reconcile(
        self,
        schedule: PrescriptionSchedule,
        *,
        until_date: date | None = None,
    ) -> list[ReminderOccurrence]:
        """Cancel superseded unsent work and idempotently upsert current occurrences."""

        self._occurrence_store.cancel_superseded(
            schedule.prescription_id, schedule.prescription_version
        )
        occurrences = generate_medication_occurrences(schedule, until_date=until_date)
        for occurrence in occurrences:
            self._occurrence_store.upsert(occurrence)
        return occurrences

    def dispatch(
        self, request: MedicationReminderRequest, *, idempotency_key: str
    ) -> AdapterResult:
        if self._occurrence_store.is_sent(request.occurrence_id):
            return AdapterResult.success(provider_reference=str(request.occurrence_id))
        if self._occurrence_store.is_cancelled(request.occurrence_id):
            return AdapterResult.terminal("REMINDER_CANCELLED")
        raw_schedule = self._resolver.resolve_prescription_schedule(
            request.prescription_id, request.prescription_version
        )
        if raw_schedule is None:
            return AdapterResult.terminal("PRESCRIPTION_REFERENCE_NOT_FOUND")
        try:
            schedule = (
                raw_schedule
                if isinstance(raw_schedule, PrescriptionSchedule)
                else PrescriptionSchedule.model_validate(raw_schedule)
            )
            occurrences = generate_medication_occurrences(schedule, from_date=schedule.start_date)
            occurrence = next(
                item for item in occurrences if item.occurrence_id == request.occurrence_id
            )
        except (StopIteration, ValueError, TypeError):
            return AdapterResult.terminal("INVALID_REMINDER_SCHEDULE")
        self._occurrence_store.upsert(occurrence)
        result = self._email.send(
            EmailRequest(
                template_key="medication_reminder",
                recipient_reference=request.recipient_reference,
                prescription_id=request.prescription_id,
                occurrence_id=request.occurrence_id,
                locale=request.locale,
            ),
            idempotency_key=idempotency_key,
        )
        if result.outcome.value == "succeeded":
            self._occurrence_store.mark_sent(request.occurrence_id)
        return result


MedicationReminderOccurrence = ReminderOccurrence
