"""Local liveness/smoke command that never contacts Redis."""

from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import Sequence

from .celery_app import create_celery_app
from .config import get_settings
from .health import live_status_sync, readiness_status_sync
from .outbox import PostgresOutboxStore


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
    parser.add_argument("--health-live", action="store_true", help="print the liveness response")
    parser.add_argument("--health-ready", action="store_true", help="print the readiness response")
    args = parser.parse_args(argv)
    if args.health_live:
        print(json.dumps(live_status_sync(service=get_settings().service_name), sort_keys=True))
        return 0
    if args.health_ready:
        settings = get_settings()
        database_url = settings.database_url
        if database_url:

            async def check_database() -> bool:
                store = await PostgresOutboxStore.from_dsn(database_url)
                try:
                    return await store.healthcheck()
                finally:
                    await store.close()

            ready = asyncio.run(check_database())
            status = readiness_status_sync(lambda: ready, service=settings.service_name)
        else:
            status = readiness_status_sync(lambda: False, service=settings.service_name)
        print(json.dumps(status, sort_keys=True))
        return 0
    if not args.smoke:
        parser.print_help()
        return 0
    print(json.dumps(smoke_status(), sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by the command itself
    raise SystemExit(main())
