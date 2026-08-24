"""Local liveness/smoke command that never contacts Redis."""

from __future__ import annotations

import argparse
import asyncio
import json
import signal
from collections.abc import Sequence
from typing import Any

from .celery_app import create_celery_app
from .config import WorkerSettings, get_settings
from .health import live_status_sync, readiness_status_sync
from .outbox import PostgresOutboxStore
from .runtime import build_outbox_poller


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


def _install_shutdown_handlers(stop_event: asyncio.Event) -> None:
    """Wake the durable poll loop for SIGINT/SIGTERM when the platform allows it."""

    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, stop_event.set)
        except (NotImplementedError, RuntimeError, ValueError):
            # Windows event loops and embedded test runners may not expose
            # add_signal_handler.  A main-thread signal callback is the safe
            # fallback; if that is unavailable the process manager still owns
            # termination and the poller's current bounded cycle can finish.
            try:
                signal.signal(signum, lambda _signal, _frame: stop_event.set())
            except (ValueError, OSError, RuntimeError):
                continue


async def run_poller(
    settings: WorkerSettings,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the durable PostgreSQL outbox poller until a graceful signal.

    ``dry_run`` assembles no pool and makes no provider/database call, which is
    useful for image smoke checks.  A normal run fails closed when PostgreSQL is
    not configured or unavailable; Celery remains a compatibility transport but
    is not the durable scheduler for this entrypoint.
    """

    if dry_run:
        return {
            "status": "ok",
            "service": settings.service_name,
            "mode": "poller",
            "dry_run": True,
            "database_configured": bool(settings.database_url),
        }

    poller = None
    store = None
    try:
        poller, store, _registry = await build_outbox_poller(settings, resolver=None)
        if not await store.healthcheck():
            return {
                "status": "unavailable",
                "service": settings.service_name,
                "mode": "poller",
                "error_code": "WORKER_DATABASE_UNAVAILABLE",
            }
        stop_event = asyncio.Event()
        _install_shutdown_handlers(stop_event)
        await poller.run(stop_event)
        return {
            "status": "stopped",
            "service": settings.service_name,
            "mode": "poller",
            "claimed": poller.metrics.claimed,
            "succeeded": poller.metrics.succeeded,
            "retried": poller.metrics.retried,
            "failed": poller.metrics.failed,
        }
    except RuntimeError as error:
        # Keep the message out of process output: it may contain a DSN or other
        # deployment detail.  The normalized code is sufficient for operators.
        del error
        return {
            "status": "unavailable",
            "service": settings.service_name,
            "mode": "poller",
            "error_code": "WORKER_DATABASE_NOT_CONFIGURED",
        }
    except Exception:
        return {
            "status": "unavailable",
            "service": settings.service_name,
            "mode": "poller",
            "error_code": "WORKER_STARTUP_FAILED",
        }
    finally:
        if store is not None:
            await store.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Healthcare worker liveness/smoke check")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="import the Celery app and print a broker-free status",
    )
    parser.add_argument(
        "--poller",
        action="store_true",
        help="run the durable PostgreSQL outbox poller until SIGINT/SIGTERM",
    )
    parser.add_argument(
        "--poller-dry-run",
        action="store_true",
        help="validate poller assembly without opening PostgreSQL or providers",
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
                try:
                    store = await PostgresOutboxStore.from_dsn(database_url)
                except Exception:
                    return False
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
    if args.poller_dry_run:
        status = asyncio.run(run_poller(get_settings(), dry_run=True))
        print(json.dumps(status, sort_keys=True))
        return 0
    if args.poller:
        status = asyncio.run(run_poller(get_settings()))
        print(json.dumps(status, sort_keys=True))
        return 0 if status.get("status") in {"stopped", "ok"} else 1
    if not args.smoke:
        parser.print_help()
        return 0
    print(json.dumps(smoke_status(), sort_keys=True))
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by the command itself
    raise SystemExit(main())
