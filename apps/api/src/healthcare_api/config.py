"""Application configuration loaded from environment variables."""

from functools import lru_cache
from typing import Annotated, Any
from urllib.parse import urlsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _normalise_origin(value: str) -> str | None:
    """Return a canonical HTTP(S) origin, or ``None`` when it is malformed."""

    if not value or any(character.isspace() for character in value) or "*" in value:
        return None

    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None

    if (
        parsed.scheme.casefold() not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or "?" in value
        or "#" in value
        or parsed.netloc.endswith(":")
        or parsed.hostname is None
        or port is not None
        and not 1 <= port <= 65535
    ):
        return None

    hostname = parsed.hostname.casefold()
    if any(character in hostname for character in "/@%,"):
        return None
    if ":" in hostname:
        hostname = f"[{hostname}]"

    scheme = parsed.scheme.casefold()
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    return f"{scheme}://{hostname}{f':{port}' if port is not None else ''}"


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
    cors_allowed_origins: Annotated[tuple[str, ...], NoDecode] = Field(
        default=(), validation_alias="CORS_ALLOWED_ORIGINS"
    )

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: Any) -> tuple[str, ...]:
        """Parse the explicit comma-separated origin environment variable."""

        if value is None:
            return ()
        if isinstance(value, str):
            if not value.strip():
                return ()
            return tuple(item.strip() for item in value.split(","))
        if isinstance(value, (list, tuple)):
            return tuple(item.strip() if isinstance(item, str) else item for item in value)
        raise ValueError("CORS_ALLOWED_ORIGINS must be a comma-separated string")

    @field_validator("cors_allowed_origins")
    @classmethod
    def _validate_cors_origins(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        """Disable CORS entirely when any configured origin is invalid."""

        normalised = tuple(
            _normalise_origin(origin) if isinstance(origin, str) else None for origin in value
        )
        if any(origin is None for origin in normalised):
            return ()
        return tuple(dict.fromkeys(origin for origin in normalised if origin is not None))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide immutable settings snapshot."""

    return Settings()
