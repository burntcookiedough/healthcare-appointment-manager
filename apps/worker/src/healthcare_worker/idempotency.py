"""Best-effort local deduplication boundary for at-least-once delivery."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from threading import RLock
from typing import Protocol


class ClaimState(StrEnum):
    CLAIMED = "claimed"
    ALREADY_SUCCEEDED = "already_succeeded"
    IN_FLIGHT = "in_flight"


@dataclass(frozen=True, slots=True)
class ClaimResult:
    state: ClaimState


class DeduplicationStore(Protocol):
    """Interface for a local fence around provider calls.

    An implementation may use Redis or another fast store, but it must not be
    treated as authoritative.  PostgreSQL outbox state remains responsible for
    durable attempts, recovery of abandoned claims, and terminal outcomes.
    """

    def claim(self, key: str) -> ClaimResult:
        """Try to claim one stable event/operation key."""

    def mark_succeeded(self, key: str) -> None:
        """Record a local success after the provider call completes."""

    def release(self, key: str) -> None:
        """Allow a retry or operator replay after a non-successful attempt."""


class InMemoryDeduplicationStore:
    """Deterministic process-local store used by this foundation and its tests.

    This store intentionally loses state on process restart.  That limitation is
    part of the contract: it is a redelivery optimization, never a replacement
    for the durable PostgreSQL outbox status and provider idempotency key.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._in_flight: set[str] = set()
        self._succeeded: set[str] = set()

    def claim(self, key: str) -> ClaimResult:
        with self._lock:
            if key in self._succeeded:
                return ClaimResult(ClaimState.ALREADY_SUCCEEDED)
            if key in self._in_flight:
                return ClaimResult(ClaimState.IN_FLIGHT)
            self._in_flight.add(key)
            return ClaimResult(ClaimState.CLAIMED)

    def mark_succeeded(self, key: str) -> None:
        with self._lock:
            self._in_flight.discard(key)
            self._succeeded.add(key)

    def release(self, key: str) -> None:
        with self._lock:
            self._in_flight.discard(key)
