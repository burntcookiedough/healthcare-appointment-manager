"""Bounded exponential backoff with injectable jitter."""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass, field

from .config import WorkerSettings


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Bound retry work without making a broker the durable scheduler."""

    max_retries: int = 5
    base_delay_seconds: float = 5.0
    max_delay_seconds: float = 900.0
    jitter_seconds: float = 3.0
    random_value: Callable[[], float] = field(default=random.random, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not 0 <= self.max_retries <= 10:
            raise ValueError("max_retries must be between 0 and 10")
        if self.base_delay_seconds <= 0:
            raise ValueError("base_delay_seconds must be positive")
        if self.max_delay_seconds <= 0:
            raise ValueError("max_delay_seconds must be positive")
        if self.jitter_seconds < 0:
            raise ValueError("jitter_seconds cannot be negative")

    def has_retries_remaining(self, retries_already_made: int) -> bool:
        """Return whether another retry may be scheduled."""

        return 0 <= retries_already_made < self.max_retries

    def delay_for(self, attempt: int) -> float:
        """Calculate a bounded delay for one-based retry ``attempt``.

        Jitter is sampled only after the exponential component is calculated and
        the final value is capped, so configuration cannot create unbounded work.
        """

        if attempt < 1:
            raise ValueError("attempt must be at least 1")
        exponential = min(
            self.max_delay_seconds,
            self.base_delay_seconds * (2 ** min(attempt - 1, 30)),
        )
        jitter_factor = self.random_value() if self.jitter_seconds else 0.0
        if not 0.0 <= jitter_factor <= 1.0:
            raise ValueError("random_value must return a value in [0, 1]")
        jitter = self.jitter_seconds * jitter_factor
        delay = exponential + jitter
        return delay if delay < self.max_delay_seconds else self.max_delay_seconds


def retry_policy_from_settings(settings: WorkerSettings) -> RetryPolicy:
    """Build the policy from validated process settings."""

    return RetryPolicy(
        max_retries=settings.max_retries,
        base_delay_seconds=settings.retry_base_delay_seconds,
        max_delay_seconds=settings.retry_max_delay_seconds,
        jitter_seconds=settings.retry_jitter_seconds,
    )
