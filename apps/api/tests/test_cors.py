"""Focused CORS policy checks for browser-to-API requests."""

from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from healthcare_api.config import Settings
from healthcare_api.main import create_app

ALLOWED_ORIGIN = "https://healthcare.vercel.app"
DENIED_ORIGIN = "https://other.vercel.app"
REQUIRED_HEADERS = {"authorization", "content-type", "idempotency-key", "x-request-id"}
ALLOWED_METHODS = {"GET", "POST", "PATCH", "PUT", "DELETE"}


def _app(*, origins: str = "", app_env: str = "test"):
    return create_app(Settings(app_env=app_env, cors_allowed_origins=origins))


def _middleware_classes(app: object) -> set[type[object]]:
    return {middleware.cls for middleware in app.user_middleware}  # type: ignore[attr-defined]


def test_default_settings_do_not_install_cors_or_grant_cross_origin_access(
    monkeypatch,
) -> None:
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    app = _app()

    assert Settings(_env_file=None).cors_allowed_origins == ()
    assert CORSMiddleware not in _middleware_classes(app)

    with TestClient(app) as client:
        response = client.get("/api/v1/health/live", headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_are_loaded_as_a_comma_separated_environment_setting(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", f"{ALLOWED_ORIGIN}, https://preview.vercel.app")

    settings = Settings(_env_file=None)

    assert settings.cors_allowed_origins == (
        ALLOWED_ORIGIN,
        "https://preview.vercel.app",
    )


def test_allowed_origin_preflight_accepts_required_headers_and_api_methods() -> None:
    with TestClient(_app(origins=ALLOWED_ORIGIN)) as client:
        response = client.options(
            "/api/v1/holds",
            headers={
                "Origin": ALLOWED_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": ", ".join(sorted(REQUIRED_HEADERS)),
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert set(response.headers["access-control-allow-methods"].split(", ")) == ALLOWED_METHODS
    allowed_headers = {
        header.strip().casefold()
        for header in response.headers["access-control-allow-headers"].split(",")
    }
    assert REQUIRED_HEADERS <= allowed_headers


def test_denied_origin_is_rejected_for_preflight_and_simple_requests() -> None:
    with TestClient(_app(origins=ALLOWED_ORIGIN)) as client:
        preflight = client.options(
            "/api/v1/health/live",
            headers={
                "Origin": DENIED_ORIGIN,
                "Access-Control-Request-Method": "GET",
            },
        )
        simple = client.get("/api/v1/health/live", headers={"Origin": DENIED_ORIGIN})

    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers
    assert simple.status_code == 200
    assert "access-control-allow-origin" not in simple.headers


def test_allowed_responses_use_credentials_and_expose_request_id_only() -> None:
    with TestClient(_app(origins=ALLOWED_ORIGIN)) as client:
        response = client.get("/api/v1/health/live", headers={"Origin": ALLOWED_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-credentials"] == "true"
    assert response.headers["access-control-expose-headers"] == "X-Request-ID"
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-origin"] != "*"
    assert response.headers["x-request-id"]


def test_production_wildcard_and_malformed_origins_fail_closed() -> None:
    wildcard = Settings(app_env="production", cors_allowed_origins="*")
    malformed = Settings(
        app_env="production", cors_allowed_origins=f"{ALLOWED_ORIGIN},https://bad.example/path"
    )

    assert wildcard.cors_allowed_origins == ()
    assert malformed.cors_allowed_origins == ()
    assert CORSMiddleware not in _middleware_classes(_app(origins="*", app_env="production"))
