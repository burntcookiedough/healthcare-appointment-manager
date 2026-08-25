FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN pip install --no-cache-dir uv==0.11.13 \
    && uv sync --frozen --no-dev

USER 10001:10001
ENTRYPOINT [".venv/bin/python", "-m", "healthcare_worker"]
CMD ["--poller"]
