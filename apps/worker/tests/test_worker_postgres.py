"""PostgreSQL contract checks for the API outbox and integration tables.

These tests intentionally use asyncpg directly so the worker exercises the same
JSONB and transaction behavior as production.  Set
``HEALTHCARE_TEST_DATABASE_URL`` (or ``TEST_DATABASE_URL``) to run them; without
one, the file is skipped rather than pretending an in-memory fake is equivalent.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from uuid import uuid4

import pytest

from healthcare_worker.outbox import PostgresOutboxStore

TEST_DATABASE_URL = os.getenv("HEALTHCARE_TEST_DATABASE_URL") or os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="set HEALTHCARE_TEST_DATABASE_URL to run PostgreSQL integration tests",
)


def _asyncpg_url(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _prepare_schema(connection: Any) -> None:
    # The DDL mirrors apps/api's 0001/0002 schema columns used by the worker.
    # Existing API migrations are left intact when this test runs alongside API
    # integration tests.
    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS outbox_events (
            id uuid PRIMARY KEY,
            event_type text NOT NULL,
            aggregate_type text NOT NULL,
            aggregate_id uuid NOT NULL,
            appointment_id uuid,
            dedupe_key text NOT NULL,
            payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            version integer NOT NULL DEFAULT 1,
            correlation_id text NOT NULL DEFAULT 'system',
            status text NOT NULL DEFAULT 'pending',
            attempt_count integer NOT NULL DEFAULT 0,
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            last_error_code text,
            created_at timestamptz NOT NULL DEFAULT now(),
            processed_at timestamptz
        )
        """
    )
    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS integration_operations (
            id uuid PRIMARY KEY,
            appointment_id uuid,
            outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
            channel text NOT NULL,
            state text NOT NULL DEFAULT 'pending',
            attempt_count integer NOT NULL DEFAULT 0,
            last_attempt_at timestamptz,
            error_code text,
            provider_reference text,
            version integer NOT NULL DEFAULT 1,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # DELETE avoids cascading into unrelated API domain rows when a shared test
    # database is used; the worker owns neither appointments nor actors.
    await connection.execute("DELETE FROM integration_operations")
    await connection.execute("DELETE FROM outbox_events")


def test_claim_decodes_api_jsonb_and_preserves_metadata() -> None:
    assert TEST_DATABASE_URL is not None

    async def scenario() -> None:
        import asyncpg

        pool = await asyncpg.create_pool(_asyncpg_url(TEST_DATABASE_URL), min_size=1, max_size=2)
        try:
            async with pool.acquire() as connection:
                await _prepare_schema(connection)
                event_id = uuid4()
                aggregate_id = uuid4()
                await connection.execute(
                    """
                    INSERT INTO outbox_events
                        (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload,
                         version, correlation_id)
                    VALUES ($1, 'calendar.sync', 'appointment', $2, $3, $4::jsonb, $5, $6)
                    """,
                    event_id,
                    aggregate_id,
                    f"calendar:{event_id}",
                    json.dumps({"appointment_id": str(aggregate_id), "action": "delete"}),
                    3,
                    "request:synthetic-42",
                )

            store = PostgresOutboxStore(pool)
            claimed = await store.claim_batch(limit=1, lease_seconds=30)
            assert len(claimed) == 1
            assert claimed[0].record.version == 3
            assert claimed[0].record.correlation_id == "request:synthetic-42"
            assert claimed[0].record.payload["action"] == "delete"
            assert claimed[0].envelope.version == 3
            assert claimed[0].envelope.correlation_id == "request:synthetic-42"
        finally:
            await pool.close()

    asyncio.run(scenario())


def test_completion_synchronizes_integration_operation_atomically() -> None:
    assert TEST_DATABASE_URL is not None

    async def scenario() -> None:
        import asyncpg

        pool = await asyncpg.create_pool(_asyncpg_url(TEST_DATABASE_URL), min_size=1, max_size=2)
        try:
            async with pool.acquire() as connection:
                await _prepare_schema(connection)
                event_id = uuid4()
                aggregate_id = uuid4()
                operation_id = uuid4()
                await connection.execute(
                    """
                    INSERT INTO outbox_events
                        (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
                    VALUES ($1, 'calendar.sync', 'appointment', $2, $3, $4::jsonb)
                    """,
                    event_id,
                    aggregate_id,
                    f"calendar:{event_id}",
                    json.dumps({"appointment_id": str(aggregate_id)}),
                )
                await connection.execute(
                    """
                    INSERT INTO integration_operations
                        (id, appointment_id, outbox_event_id, channel, state,
                         attempt_count, provider_reference, version)
                    VALUES ($1, $2, $3, 'calendar', 'pending', 0, 'trusted-existing-ref', 4)
                    """,
                    operation_id,
                    None,
                    event_id,
                )

            store = PostgresOutboxStore(pool)
            first = (await store.claim_batch(limit=1, lease_seconds=30))[0]
            assert await store.mark_retryable(
                event_id,
                attempt=first.attempt,
                error_code="CALENDAR_TIMEOUT",
                delay_seconds=0,
            )
            async with pool.acquire() as connection:
                retry_state = await connection.fetchrow(
                    """SELECT status, attempt_count, last_error_code
                       FROM outbox_events WHERE id = $1""",
                    event_id,
                )
                retry_operation = await connection.fetchrow(
                    """SELECT state, attempt_count, error_code, provider_reference, version
                       FROM integration_operations WHERE outbox_event_id = $1""",
                    event_id,
                )
                assert tuple(retry_state) == ("retrying", 1, "CALENDAR_TIMEOUT")
                assert tuple(retry_operation) == (
                    "retrying",
                    1,
                    "CALENDAR_TIMEOUT",
                    "trusted-existing-ref",
                    5,
                )
                await connection.execute(
                    "UPDATE outbox_events SET next_attempt_at = now() WHERE id = $1", event_id
                )

            second = (await store.claim_batch(limit=1, lease_seconds=30))[0]
            assert second.attempt == 2
            assert await store.mark_succeeded(
                event_id,
                attempt=second.attempt,
                provider_reference="provider-ref-2",
            )
            async with pool.acquire() as connection:
                success_state = await connection.fetchrow(
                    """SELECT status, attempt_count, last_error_code
                       FROM outbox_events WHERE id = $1""",
                    event_id,
                )
                success_operation = await connection.fetchrow(
                    """SELECT state, attempt_count, error_code, provider_reference, version
                       FROM integration_operations WHERE outbox_event_id = $1""",
                    event_id,
                )
                assert tuple(success_state) == ("succeeded", 2, None)
                assert tuple(success_operation) == (
                    "succeeded",
                    2,
                    None,
                    "provider-ref-2",
                    6,
                )
        finally:
            await pool.close()

    asyncio.run(scenario())


def test_failed_completion_synchronizes_terminal_state() -> None:
    assert TEST_DATABASE_URL is not None

    async def scenario() -> None:
        import asyncpg

        pool = await asyncpg.create_pool(_asyncpg_url(TEST_DATABASE_URL), min_size=1, max_size=2)
        try:
            async with pool.acquire() as connection:
                await _prepare_schema(connection)
                event_id = uuid4()
                aggregate_id = uuid4()
                await connection.execute(
                    """
                    INSERT INTO outbox_events
                        (id, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
                    VALUES ($1, 'email.notification', 'appointment', $2, $3, $4::jsonb)
                    """,
                    event_id,
                    aggregate_id,
                    f"email:{event_id}",
                    json.dumps({"appointment_id": str(aggregate_id)}),
                )
                await connection.execute(
                    """
                    INSERT INTO integration_operations
                        (id, appointment_id, outbox_event_id, channel, provider_reference)
                    VALUES ($1, $2, $3, 'email', 'existing-email-ref')
                    """,
                    uuid4(),
                    None,
                    event_id,
                )
            store = PostgresOutboxStore(pool)
            claimed = (await store.claim_batch(limit=1, lease_seconds=30))[0]
            assert await store.mark_failed(
                event_id,
                attempt=claimed.attempt,
                error_code="EMAIL_INVALID",
            )
            async with pool.acquire() as connection:
                operation = await connection.fetchrow(
                    """SELECT state, error_code, provider_reference, version
                       FROM integration_operations WHERE outbox_event_id = $1""",
                    event_id,
                )
                assert tuple(operation) == ("failed", "EMAIL_INVALID", "existing-email-ref", 2)
        finally:
            await pool.close()

    asyncio.run(scenario())
