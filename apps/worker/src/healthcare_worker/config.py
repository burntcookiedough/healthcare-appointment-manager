"""Typed configuration for the background worker.

The worker receives durable work from the PostgreSQL outbox.  Redis is configured
as the Celery transport only; no setting in this module makes broker state the
source of truth for an appointment or an outbox record.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]


class WorkerSettings(BaseSettings):
    """Environment-backed settings with bounded retry controls."""

    model_config = SettingsConfigDict(
        env_prefix="HEALTHCARE_WORKER_",
        extra="ignore",
        validate_default=True,
    )

    service_name: str = Field(default="healthcare-worker", min_length=1, max_length=64)
    environment: Environment = "development"
    broker_url: RedisDsn = Field(default=RedisDsn("redis://localhost:6379/0"))
    result_backend_url: RedisDsn | None = None
    event_version: int = Field(default=1, ge=1, le=100)
    max_retries: int = Field(default=5, ge=0, le=10)
    retry_base_delay_seconds: float = Field(default=5.0, gt=0, le=60)
    retry_max_delay_seconds: float = Field(default=900.0, gt=0, le=3600)
    retry_jitter_seconds: float = Field(default=3.0, ge=0, le=60)
    task_queue: str = Field(default="healthcare-worker", min_length=1, max_length=64)

    @property
    def redis_broker_url(self) -> RedisDsn:
        """Explicit name for the Redis transport setting."""

        return self.broker_url

    @property
    def redis_result_backend_url(self) -> RedisDsn | None:
        """Explicit name for the optional Redis result backend setting."""

        return self.result_backend_url

    @property
    def celery_config(self) -> dict[str, object]:
        """Return transport-safe Celery configuration.

        The task serializer is deliberately restricted to JSON so a task cannot
        smuggle an arbitrary Python object through the broker.  The result backend
        is optional because durable outcome state belongs in PostgreSQL.
        """

        config: dict[str, object] = {
            "broker_url": str(self.broker_url),
            "result_backend": (
                str(self.result_backend_url) if self.result_backend_url is not None else None
            ),
            "task_serializer": "json",
            "result_serializer": "json",
            "accept_content": ["json"],
            "enable_utc": True,
            "task_track_started": True,
            "task_acks_late": True,
            "task_reject_on_worker_lost": True,
            "worker_prefetch_multiplier": 1,
            "broker_connection_retry_on_startup": True,
            "task_default_queue": self.task_queue,
            "task_default_exchange": self.task_queue,
            "task_default_routing_key": self.task_queue,
            "imports": ("healthcare_worker.tasks",),
        }
        return config


@lru_cache(maxsize=1)
def get_settings() -> WorkerSettings:
    """Load process settings once; tests can call ``cache_clear`` when needed."""

    return WorkerSettings()


# Conventional short name for application code and test fixtures.
Settings = WorkerSettings
