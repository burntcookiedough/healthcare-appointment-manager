FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

WORKDIR /app

# Keep dependency resolution reproducible and keep the build context limited to
# runtime inputs.  The migration directory is intentionally copied so the same
# image can run `alembic upgrade head` through RUN_MIGRATIONS=true.
COPY pyproject.toml uv.lock README.md ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
COPY docker-entrypoint.py ./

RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev \
    && /app/.venv/bin/python -c "import healthcare_api; import healthcare_api.main"

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin healthcare
USER 10001:10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD ["/usr/local/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/live', timeout=2)"]

ENTRYPOINT ["/app/.venv/bin/python", "/app/docker-entrypoint.py"]
CMD ["/app/.venv/bin/uvicorn", "healthcare_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
