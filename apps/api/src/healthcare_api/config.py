"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings.

    Supabase access-token verification is fail-closed by default.  The local test
    subject shortcut is opt-in and is rejected outside an explicitly local environment.
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
    supabase_jwt_secret: str | None = Field(default=None, validation_alias="SUPABASE_JWT_SECRET")
    supabase_jwt_public_key: str | None = Field(
        default=None, validation_alias="SUPABASE_JWT_PUBLIC_KEY"
    )
    supabase_jwt_issuer: str | None = Field(default=None, validation_alias="SUPABASE_JWT_ISSUER")
    supabase_jwt_audience: str | None = Field(
        default=None, validation_alias="SUPABASE_JWT_AUDIENCE"
    )
    auth_allow_local_test_tokens: bool = Field(
        default=False, validation_alias="AUTH_ALLOW_LOCAL_TEST_TOKENS"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide immutable settings snapshot."""

    return Settings()
