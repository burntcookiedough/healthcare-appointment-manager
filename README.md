# Healthcare Appointment & Follow-up Manager

Contract-first monorepo for a healthcare scheduling and follow-up system serving patients, doctors, and administrators.

## Current status

Phase 0: repository initialization and architecture. Application features have not yet been implemented.

## Planned applications

- `apps/web`: Next.js frontend, reserved for Gemini Antigravity.
- `apps/api`: FastAPI HTTP service.
- `apps/worker`: Celery background worker.
- `packages/api-client`: Orval-generated TypeScript client from FastAPI OpenAPI.

## Start here

1. Read `AGENTS.md` for the operating model.
2. Read `PLAN.md` for phases and ownership.
3. Read the documents in `docs/` before implementing a subsystem.
4. Copy `.env.example` to local environment files only when implementation begins; never commit secrets.

## Prerequisites

- Node.js 24+
- pnpm 11+
- Python 3.13+
- Docker Desktop with Compose

## Root commands

The command surface is reserved now and will become active as each application is implemented:

```bash
pnpm install
pnpm dev
pnpm lint
pnpm test
pnpm build
```

Python services will use their own `pyproject.toml` files and lockfiles so the JavaScript workspace does not pretend to manage Python dependencies.

## Security

This repository must contain no patient data, OAuth tokens, API keys, or production database exports. Use synthetic demo data only.
