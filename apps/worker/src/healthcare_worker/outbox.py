"""PostgreSQL transactional-outbox claiming, leases, and bounded polling."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

from .envelope import EventEnvelope, JsonValue
from .logging import safe_event_type, safe_log
from .results import ProcessingOutcome, ProcessingResult
from .retry import RetryPolicy

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class OutboxRecord:
    """A row returned by the API's existing ``outbox_events`` table."""

    event_id: UUID
    event_type: str
    aggregate_type: str
    aggregate_id: UUID
    dedupe_key: str
    payload: dict[str, JsonValue]
    status: str = "pending"
    attempt_count: int = 0
    next_attempt_at: datetime | None = None
    last_error_code: str | None = None
    created_at: datetime | None = None
    processed_at: datetime | None = None
    appointment_id: UUID | None = None
    version: int = 1
    correlation_id: str | None = None
    recovered: bool = False

    @classmethod
    def from_mapping(cls, row: Mapping[str, Any], *, recovered: bool = False) -> OutboxRecord:
        event_id = row.get("event_id") or row.get("id")
        if not isinstance(event_id, UUID):
            event_id = UUID(str(event_id))
        aggregate_id = row.get("aggregate_id")
        if not isinstance(aggregate_id, UUID):
            aggregate_id = UUID(str(aggregate_id))
        payload = _decode_json_object(row.get("payload"))
        raw_appointment_id = row.get("appointment_id")
        appointment_id = raw_appointment_id
        if raw_appointment_id is not None and not isinstance(raw_appointment_id, UUID):
            appointment_id = UUID(str(raw_appointment_id))
        raw_correlation_id = row.get("correlation_id")
        return cls(
            event_id=event_id,
            event_type=str(row["event_type"]),
            aggregate_type=str(row.get("aggregate_type", "aggregate")),
            aggregate_id=aggregate_id,
            dedupe_key=str(row.get("dedupe_key", event_id)),
            payload=payload,
            status=str(row.get("status", "pending")),
            attempt_count=int(row.get("attempt_count", 0)),
            next_attempt_at=row.get("next_attempt_at"),
            last_error_code=(str(row["last_error_code"]) if row.get("last_error_code") else None),
            created_at=row.get("created_at"),
            processed_at=row.get("processed_at"),
            appointment_id=appointment_id,
            version=int(row.get("version", 1)),
            correlation_id=(str(raw_correlation_id) if raw_correlation_id else None),
            recovered=recovered,
        )

    def envelope(self, *, version: int | None = None) -> EventEnvelope:
        """Convert an API row to the narrow versioned worker event envelope."""

        return EventEnvelope(
            version=self.version if version is None else version,
            event_id=self.event_id,
            correlation_id=self.correlation_id or f"outbox:{self.event_id}",
            aggregate_id=self.aggregate_id,
            event_type=self.event_type,
            payload=self.payload,
        )


def _decode_json_object(value: Any) -> dict[str, JsonValue]:
    """Normalize asyncpg JSONB output without exposing conversion details.

    asyncpg normally decodes JSONB to a mapping, but deployments may register a
    text/bytes codec.  Claim conversion is performed inside the SQL transaction,
    so a malformed value raises before the claim can commit and the row remains
    claimable.
    """

    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytearray):
        value = bytes(value)
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("outbox payload is not valid JSON") from error
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("outbox payload is not valid JSON") from error
        if isinstance(decoded, Mapping):
            return dict(decoded)
    raise ValueError("outbox payload must be a JSON object")


@dataclass(frozen=True, slots=True)
class ClaimedOutboxEvent:
    record: OutboxRecord
    attempt: int
    lease_until: datetime

    @property
    def envelope(self) -> EventEnvelope:
        return self.record.envelope()


class OutboxStore(Protocol):
    async def claim_batch(self, *, limit: int, lease_seconds: float) -> list[ClaimedOutboxEvent]:
        """Claim due rows with a database-side lock and fencing attempt."""

    async def mark_succeeded(
        self, event_id: UUID, *, attempt: int, provider_reference: str | None
    ) -> bool:
        """Record success only for the current fencing attempt."""

    async def mark_retryable(
        self, event_id: UUID, *, attempt: int, error_code: str, delay_seconds: float
    ) -> bool:
        """Persist retry state and next due time for the current fencing attempt."""

    async def mark_failed(self, event_id: UUID, *, attempt: int, error_code: str) -> bool:
        """Persist terminal failure without deleting the durable intent."""

    async def healthcheck(self) -> bool:
        """Check database reachability without returning dependency details."""


CLAIM_BATCH_SQL = """
WITH candidates AS (
    SELECT id, status AS previous_status
    FROM outbox_events
    WHERE (
        (status IN ('pending', 'retrying') AND next_attempt_at <= now())
        OR (status = 'processing' AND next_attempt_at <= now())
    )
    ORDER BY next_attempt_at ASC, created_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT $1
)
UPDATE outbox_events AS event
SET status = 'processing',
    attempt_count = event.attempt_count + 1,
    next_attempt_at = now() + ($2::double precision * interval '1 second')
FROM candidates
WHERE event.id = candidates.id
RETURNING event.id, event.event_type, event.aggregate_type, event.aggregate_id,
          event.appointment_id, event.dedupe_key, event.payload, event.status,
          event.attempt_count, event.next_attempt_at, event.last_error_code,
          event.created_at, event.processed_at, event.version, event.correlation_id,
          candidates.previous_status
"""

MARK_SUCCEEDED_SQL = """
UPDATE outbox_events
SET status = 'succeeded', processed_at = now(), next_attempt_at = now(),
    last_error_code = NULL
WHERE id = $1 AND status = 'processing' AND attempt_count = $2
"""

MARK_RETRYABLE_SQL = """
UPDATE outbox_events
SET status = 'retrying', next_attempt_at = now() + ($3::double precision * interval '1 second'),
    last_error_code = $4
WHERE id = $1 AND status = 'processing' AND attempt_count = $2
"""

MARK_FAILED_SQL = """
UPDATE outbox_events
SET status = 'failed', processed_at = now(), next_attempt_at = now(),
    last_error_code = $3
WHERE id = $1 AND status = 'processing' AND attempt_count = $2
"""

# Integration operations are linked by the outbox UUID.  These statements are
# executed on the same connection and transaction as their outbox status update;
# an exception rolls both changes back.  Provider references are intentionally
# preserved when a retry/terminal result has no new reference.
SYNC_INTEGRATION_SUCCEEDED_SQL = """
UPDATE integration_operations
SET state = 'succeeded',
    attempt_count = GREATEST(attempt_count, $2),
    last_attempt_at = now(),
    error_code = NULL,
    provider_reference = COALESCE(NULLIF($3, ''), provider_reference),
    version = version + 1,
    updated_at = now()
WHERE outbox_event_id = $1
"""

SYNC_INTEGRATION_RETRYABLE_SQL = """
UPDATE integration_operations
SET state = 'retrying',
    attempt_count = GREATEST(attempt_count, $2),
    last_attempt_at = now(),
    error_code = $3,
    version = version + 1,
    updated_at = now()
WHERE outbox_event_id = $1
"""

SYNC_INTEGRATION_FAILED_SQL = """
UPDATE integration_operations
SET state = 'failed',
    attempt_count = GREATEST(attempt_count, $2),
    last_attempt_at = now(),
    error_code = $3,
    version = version + 1,
    updated_at = now()
WHERE outbox_event_id = $1
"""


class PostgresOutboxStore:
    """Asyncpg-backed store compatible with the API's Phase 1 schema."""

    def __init__(self, pool: Any) -> None:
        self._pool = pool

    @property
    def pool(self) -> Any:
        """Return the shared async pool for other trusted worker repositories."""

        return self._pool

    @classmethod
    async def from_dsn(
        cls, dsn: str, *, min_size: int = 1, max_size: int = 10
    ) -> PostgresOutboxStore:
        """Create a pool lazily; importing the driver is optional in fake/test mode."""

        try:
            import asyncpg
        except ImportError as error:  # pragma: no cover - exercised only in misconfigured deploys
            raise RuntimeError("asyncpg is required for PostgreSQL outbox polling") from error
        # The API documents SQLAlchemy's ``postgresql+asyncpg://`` form while
        # asyncpg itself expects the driver-neutral ``postgresql://`` scheme.
        normalized_dsn = dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
        pool = await asyncpg.create_pool(normalized_dsn, min_size=min_size, max_size=max_size)
        return cls(pool)

    async def close(self) -> None:
        await self._pool.close()

    async def claim_batch(self, *, limit: int, lease_seconds: float) -> list[ClaimedOutboxEvent]:
        if limit < 1 or lease_seconds <= 0:
            raise ValueError("claim limit and lease must be positive")
        # Decode all returned JSONB values before leaving this transaction.  If
        # one row cannot be converted, the transaction rolls back the UPDATE and
        # its lease, rather than stranding a row in ``processing``.
        async with self._pool.acquire() as connection, connection.transaction():
            rows = await connection.fetch(CLAIM_BATCH_SQL, limit, lease_seconds)
            claimed: list[ClaimedOutboxEvent] = []
            for row in rows:
                record = OutboxRecord.from_mapping(
                    row,
                    recovered=str(row.get("previous_status", "")).casefold() == "processing",
                )
                lease_until = record.next_attempt_at or datetime.now(UTC) + timedelta(
                    seconds=lease_seconds
                )
                claimed.append(
                    ClaimedOutboxEvent(
                        record=record, attempt=record.attempt_count, lease_until=lease_until
                    )
                )
        return claimed

    async def mark_succeeded(
        self, event_id: UUID, *, attempt: int, provider_reference: str | None
    ) -> bool:
        async with self._pool.acquire() as connection, connection.transaction():
            status = await connection.execute(MARK_SUCCEEDED_SQL, event_id, attempt)
            if _updated_one(status):
                await connection.execute(
                    SYNC_INTEGRATION_SUCCEEDED_SQL, event_id, attempt, provider_reference
                )
        return _updated_one(status)

    async def mark_retryable(
        self, event_id: UUID, *, attempt: int, error_code: str, delay_seconds: float
    ) -> bool:
        async with self._pool.acquire() as connection, connection.transaction():
            status = await connection.execute(
                MARK_RETRYABLE_SQL,
                event_id,
                attempt,
                max(0.0, min(delay_seconds, 3600.0)),
                error_code,
            )
            if _updated_one(status):
                await connection.execute(
                    SYNC_INTEGRATION_RETRYABLE_SQL, event_id, attempt, error_code
                )
        return _updated_one(status)

    async def mark_failed(self, event_id: UUID, *, attempt: int, error_code: str) -> bool:
        async with self._pool.acquire() as connection, connection.transaction():
            status = await connection.execute(MARK_FAILED_SQL, event_id, attempt, error_code)
            if _updated_one(status):
                await connection.execute(SYNC_INTEGRATION_FAILED_SQL, event_id, attempt, error_code)
        return _updated_one(status)

    async def healthcheck(self) -> bool:
        try:
            async with self._pool.acquire() as connection:
                await connection.fetchval("SELECT 1")
            return True
        except Exception:
            return False


def _updated_one(status: str) -> bool:
    try:
        return int(str(status).split()[-1]) == 1
    except (TypeError, ValueError):
        return str(status).upper().endswith(" 1")


@dataclass(slots=True)
class PollerMetrics:
    claimed: int = 0
    recovered: int = 0
    succeeded: int = 0
    retried: int = 0
    failed: int = 0
    stale_updates: int = 0


ProcessCallable = Callable[[EventEnvelope], ProcessingResult | Awaitable[ProcessingResult]]


class OutboxPoller:
    """Poll and process durable rows with bounded concurrency and retry state."""

    def __init__(
        self,
        store: OutboxStore,
        processor: ProcessCallable,
        *,
        max_concurrency: int = 10,
        batch_size: int = 50,
        lease_seconds: float = 120.0,
        poll_interval_seconds: float = 2.0,
        retry_policy: RetryPolicy | None = None,
        logger: logging.Logger = LOGGER,
    ) -> None:
        if (
            max_concurrency < 1
            or batch_size < 1
            or lease_seconds <= 0
            or poll_interval_seconds <= 0
        ):
            raise ValueError("poller bounds must be positive")
        self.store = store
        self.processor = processor
        self.max_concurrency = max_concurrency
        self.batch_size = min(batch_size, max_concurrency)
        self.lease_seconds = lease_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.retry_policy = retry_policy or RetryPolicy()
        self.logger = logger
        self.metrics = PollerMetrics()

    async def poll_once(self) -> list[ProcessingResult]:
        claimed = await self.store.claim_batch(
            limit=self.batch_size, lease_seconds=self.lease_seconds
        )
        self.metrics.claimed += len(claimed)
        self.metrics.recovered += sum(1 for item in claimed if item.record.recovered)
        if not claimed:
            return []
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def run(item: ClaimedOutboxEvent) -> ProcessingResult:
            async with semaphore:
                return await self._process_claim(item)

        return list(await asyncio.gather(*(run(item) for item in claimed)))

    async def _process_claim(self, item: ClaimedOutboxEvent) -> ProcessingResult:
        try:
            result = self.processor(item.envelope)
            if inspect.isawaitable(result):
                result = await result
            if not isinstance(result, ProcessingResult):
                raise TypeError("processor returned an invalid result")
        except Exception:
            result = ProcessingResult.retryable(
                item.record.event_id,
                error_code="WORKER_PROCESSING_ERROR",
                attempt=item.attempt,
            )
        result = result.with_attempt(item.attempt)
        if result.outcome is ProcessingOutcome.SUCCEEDED:
            self._log_result(item, result)
            updated = await self.store.mark_succeeded(
                item.record.event_id,
                attempt=item.attempt,
                provider_reference=result.provider_reference,
            )
            if updated:
                self.metrics.succeeded += 1
            else:
                self.metrics.stale_updates += 1
            return result
        if result.outcome is ProcessingOutcome.RETRYABLE_FAILURE:
            retries_already_made = max(0, item.attempt - 1)
            if not self.retry_policy.has_retries_remaining(retries_already_made):
                terminal = ProcessingResult.terminal(
                    item.record.event_id,
                    error_code="RETRY_CEILING_EXCEEDED",
                    attempt=item.attempt,
                )
                self._log_result(item, terminal)
                updated = await self.store.mark_failed(
                    item.record.event_id,
                    attempt=item.attempt,
                    error_code=terminal.error_code or "RETRY_CEILING_EXCEEDED",
                )
                if updated:
                    self.metrics.failed += 1
                else:
                    self.metrics.stale_updates += 1
                return terminal
            delay = self.retry_policy.delay_for(item.attempt)
            if result.retry_after_seconds is not None:
                delay = min(
                    self.retry_policy.max_delay_seconds, max(delay, result.retry_after_seconds)
                )
            updated = await self.store.mark_retryable(
                item.record.event_id,
                attempt=item.attempt,
                error_code=result.error_code or "PROVIDER_TEMPORARY_FAILURE",
                delay_seconds=delay,
            )
            self._log_result(item, result)
            if updated:
                self.metrics.retried += 1
            else:
                self.metrics.stale_updates += 1
            return result
        updated = await self.store.mark_failed(
            item.record.event_id,
            attempt=item.attempt,
            error_code=result.error_code or "PROVIDER_TERMINAL_FAILURE",
        )
        self._log_result(item, result)
        if updated:
            self.metrics.failed += 1
        else:
            self.metrics.stale_updates += 1
        return result

    def _log_result(self, item: ClaimedOutboxEvent, result: ProcessingResult) -> None:
        """Record retry/terminal observability without event payload or exception text."""

        safe_log(
            self.logger,
            logging.INFO if result.is_success else logging.WARNING,
            "outbox_attempt",
            fields={
                "event_id": str(item.record.event_id),
                "aggregate_id": str(item.record.aggregate_id),
                "event_type": safe_event_type(item.record.event_type),
                "attempt": item.attempt,
                "outcome": result.outcome.value,
                "error_code": result.error_code,
                "retry_after_seconds": result.retry_after_seconds,
            },
        )

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """Run until stopped; each wake is bounded and recoverable."""

        stop = stop_event or asyncio.Event()
        while not stop.is_set():
            try:
                await self.poll_once()
            except Exception:
                safe_log(
                    self.logger,
                    logging.ERROR,
                    "outbox_poll_failed",
                    fields={"error_code": "OUTBOX_UNAVAILABLE"},
                )
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.poll_interval_seconds)
            except TimeoutError:
                continue


class InMemoryOutboxStore:
    """Deterministic store that mirrors durable claim/lease/fencing semantics."""

    def __init__(self, records: Sequence[OutboxRecord] = ()) -> None:
        self.records: dict[UUID, OutboxRecord] = {record.event_id: record for record in records}
        self.provider_references: dict[UUID, str | None] = {}

    def add(self, record: OutboxRecord) -> None:
        self.records[record.event_id] = record

    async def claim_batch(self, *, limit: int, lease_seconds: float) -> list[ClaimedOutboxEvent]:
        now = datetime.now(UTC)
        due: list[OutboxRecord] = []
        for record in self.records.values():
            due_at = record.next_attempt_at or now
            if (
                record.status in {"pending", "retrying"}
                and due_at <= now
                or record.status == "processing"
                and due_at <= now
            ):
                due.append(record)
        due.sort(
            key=lambda record: (
                record.next_attempt_at or now,
                record.created_at or now,
                record.event_id,
            )
        )
        claimed: list[ClaimedOutboxEvent] = []
        for record in due[:limit]:
            recovered = record.status == "processing"
            attempt = record.attempt_count + 1
            lease_until = now + timedelta(seconds=lease_seconds)
            updated = replace(
                record,
                status="processing",
                attempt_count=attempt,
                next_attempt_at=lease_until,
                recovered=recovered,
            )
            self.records[record.event_id] = updated
            claimed.append(ClaimedOutboxEvent(updated, attempt, lease_until))
        return claimed

    def _fenced(self, event_id: UUID, attempt: int) -> OutboxRecord | None:
        record = self.records.get(event_id)
        return (
            record
            if record and record.status == "processing" and record.attempt_count == attempt
            else None
        )

    async def mark_succeeded(
        self, event_id: UUID, *, attempt: int, provider_reference: str | None
    ) -> bool:
        record = self._fenced(event_id, attempt)
        if record is None:
            return False
        now = datetime.now(UTC)
        self.records[event_id] = replace(
            record, status="succeeded", processed_at=now, next_attempt_at=now
        )
        if provider_reference or event_id not in self.provider_references:
            self.provider_references[event_id] = provider_reference
        return True

    async def mark_retryable(
        self, event_id: UUID, *, attempt: int, error_code: str, delay_seconds: float
    ) -> bool:
        record = self._fenced(event_id, attempt)
        if record is None:
            return False
        next_attempt = datetime.now(UTC) + timedelta(seconds=delay_seconds)
        self.records[event_id] = replace(
            record, status="retrying", next_attempt_at=next_attempt, last_error_code=error_code
        )
        return True

    async def mark_failed(self, event_id: UUID, *, attempt: int, error_code: str) -> bool:
        record = self._fenced(event_id, attempt)
        if record is None:
            return False
        now = datetime.now(UTC)
        self.records[event_id] = replace(
            record,
            status="failed",
            processed_at=now,
            next_attempt_at=now,
            last_error_code=error_code,
        )
        return True

    async def healthcheck(self) -> bool:
        return True


# Names used by deployment/integration code that wants to emphasize the durable
# PostgreSQL boundary rather than the generic poller implementation.
TransactionalOutboxPoller = OutboxPoller
PostgresOutboxPoller = OutboxPoller
PostgresOutboxRepository = PostgresOutboxStore
