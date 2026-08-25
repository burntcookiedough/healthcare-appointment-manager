"""Small container entrypoint with optional migration support."""

from __future__ import annotations

import os
import subprocess
import sys


def main() -> None:
    if os.environ.get("RUN_MIGRATIONS", "false").casefold() in {"1", "true", "yes"}:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            check=True,
        )
    if len(sys.argv) < 2:
        raise SystemExit("container command is required")
    os.execv(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
