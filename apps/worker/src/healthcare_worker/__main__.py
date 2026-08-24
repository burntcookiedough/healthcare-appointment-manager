"""Local liveness/smoke command that never contacts Redis."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from .celery_app import create_celery_app
from .config import get_settings


def smoke_status() -> dict[str, str]:
    """Import and configure Celery while avoiding a broker connection."""

    settings = get_settings()
    app = create_celery_app(settings)
    broker_scheme = str(settings.broker_url).split(":", 1)[0]
    return {
        "status": "ok",
        "service": settings.service_name,
        "celery_app": app.main,
        "broker_scheme": broker_scheme,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Healthcare worker liveness/smoke check")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="import the Celery app and print a broker-free status",
    )
    args = parser.parse_args(argv)
    if not args.smoke:
        parser.print_help()
        return 0
    print(json.dumps(smoke_status(), sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by the command itself
    raise SystemExit(main())
