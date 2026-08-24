# Final submission checklist

Use this checklist from the exact candidate commit. Checkboxes describe evidence to
collect; this documentation change does not claim that hosted services or external
providers have been deployed.

## Source and scope

- [ ] `git rev-parse HEAD` matches the approved candidate commit and
  `git status --short` is clean before packaging.
- [ ] `git diff --name-only <base>..HEAD` contains only the delegated docs,
  infrastructure, root deployment manifests, environment template, CI workflow, and
  allowed seed file.
- [ ] No `apps/**` feature code, `packages/**`, package manifest, lockfile, or
  generated client was changed by this docs/deployment lane.
- [ ] `git ls-files` contains no `.env`, provider key, OAuth token, refresh token,
  database dump, patient data, dependency directory, cache, worktree, or build output.
- [ ] All demos, examples, IDs, email addresses, and clinical text are synthetic.

## Documentation completeness

- [ ] [README.md](../README.md) covers Windows PowerShell, macOS/Linux, prerequisites,
  frozen installs, Compose PostgreSQL/Redis, migrations, seed/demo accounts, web/API/
  worker processes, tests, and troubleshooting.
- [ ] [ENVIRONMENT.md](ENVIRONMENT.md) and [`.env.example`](../.env.example) agree
  on names, defaults, secret ownership, and optional/degraded behavior.
- [ ] [API_GUIDE.md](API_GUIDE.md) lists the current executable route inventory, auth
  boundary, frontend HTTP/demo adapter, and OpenAPI/client gate.
- [ ] [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) describes both executable migrations and
  names the current clinical, generated-artifact, integration, history, leave-preview,
  and reminder tables.
- [ ] [LLM_PROMPTS.md](LLM_PROMPTS.md) records exact versioned prompts, JSON Schemas,
  provenance/version storage, and timeout/refusal/schema-failure behavior.
- [ ] [INTEGRATIONS.md](INTEGRATIONS.md) includes Google OAuth/Calendar, SendGrid, and
  LLM setup with server-only secret handling.
- [ ] [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) is no more than 800 words and covers
  double-booking, leave conflicts, holds, and notification retry/degradation.
- [ ] [DEPLOYMENT.md](DEPLOYMENT.md) separates configured source from not-deployed
  infrastructure and documents Vercel plus Render/Railway-compatible operations.
- [ ] [docs/README.md](README.md) links the new guides.

## Validation commands

Run from the repository root unless noted:

```text
git diff --check
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @healthcare-manager/web lint
corepack pnpm --filter @healthcare-manager/web typecheck
corepack pnpm --filter @healthcare-manager/web test
corepack pnpm --filter @healthcare-manager/web build
(cd apps/api && uv sync --locked --extra dev && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy src && uv run python -m compileall -q src tests && uv run alembic upgrade head && uv run pytest)
(cd apps/worker && uv sync --locked --all-groups && uv run ruff check src tests && uv run ruff format --check src tests && uv run mypy src && uv run python -m compileall -q src tests && uv run pytest)
```

For PostgreSQL evidence, point `HEALTHCARE_TEST_DATABASE_URL` at a disposable isolated
PostgreSQL 17 database, apply `uv run alembic upgrade head`, and run the complete API
suite. The fixtures drop/truncate only that test database. Do not run them against a
shared or production database. Deployment validation is static/config-only; do not send
provider requests.

Also verify, with available local tooling:

- [ ] `render.yaml` parses as YAML and its service roots/commands match the lockfiles.
- [ ] `vercel.json` parses as JSON and its build command targets the web package.
- [ ] CI uses Node 24, pnpm 11.23.0, Python 3.13, and frozen installs.
- [ ] API health path and Render health check agree.
- [ ] `infra/seed-demo.sql` uses only current `0001`/`0002` migration tables and deterministic
  synthetic IDs.
- [ ] No docs link points at a missing path.
- [ ] A secret scan over owned files finds no non-placeholder credential.
- [ ] The system-design word count is recorded below.

## Reproducible source archive (do not create during this task)

After the final accepted commit is selected, create the archive from that commit:

```text
git archive --format=zip --prefix=healthcare-appointment-manager/ --output=healthcare-appointment-manager-source.zip HEAD
tar -tf healthcare-appointment-manager-source.zip
# or: unzip -l healthcare-appointment-manager-source.zip
```

Because `git archive` includes committed files only, it excludes Git metadata,
ignored dependencies/caches/worktrees, local `.env` files, and untracked outputs.
Before sharing, inspect `git archive --list HEAD` and verify that the only tracked
environment file is `.env.example` with placeholders. Do not add the generated zip to
the repository.
