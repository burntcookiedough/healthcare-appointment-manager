"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings.

    Supabase verification is deliberately outside this Phase 1 boundary.  The actor
    dependency is narrow and overrideable in tests; production authentication can be
    attached without changing booking services.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = Field(default="development", validation_alias="APP_ENV")
    api_host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    api_port: int = Field(default=8000, validation_alias="API_PORT")
    api_prefix: str = Field(default="/api/v1", validation_alias="API_PREFIX")
    database_url: str = Field(
        default="postgresql+asyncpg://healthcare:healthcare@localhost:5432/healthcare",
        validation_alias="DATABASE_URL",
    )
    hold_ttl_seconds: int = Field(default=600, ge=1, le=86400, validation_alias="HOLD_TTL_SECONDS")
    readiness_timeout_seconds: float = Field(
        default=2.0, gt=0, le=10, validation_alias="READINESS_TIMEOUT_SECONDS"
    )
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide immutable settings snapshot."""

    return Settings()
