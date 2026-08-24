"""Celery application factory for the Redis-backed worker transport."""

from celery import Celery

from .config import WorkerSettings, get_settings


def create_celery_app(settings: WorkerSettings | None = None) -> Celery:
    """Create a configured Celery app without opening a broker connection."""

    resolved = settings or get_settings()
    app = Celery(resolved.service_name)
    app.conf.update(resolved.celery_config)
    app.conf.task_routes = {
        "healthcare_worker.tasks.process_event": {
            "queue": resolved.task_queue,
            "routing_key": resolved.task_queue,
        }
    }
    return app


celery_app = create_celery_app()
app = celery_app

# Register the entrypoint for both direct imports and a Celery worker boot.  The
# import is intentionally after app construction to keep the factory cycle-free.
from . import tasks as _tasks  # noqa: E402,F401
