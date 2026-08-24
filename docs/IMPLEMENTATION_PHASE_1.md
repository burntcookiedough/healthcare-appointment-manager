# Phase 1 implementation record

Status: historical lane plan; the current executable surface is summarized in
[`API_GUIDE.md`](API_GUIDE.md), [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md), and
[`DEPLOYMENT.md`](DEPLOYMENT.md).

The sole supervisor coordinates two Codex worker tasks and one external Gemini Antigravity frontend lane. Every lane starts from the exact Phase 1 canonical commit and uses a separate Git worktree.

## Lanes

| Lane | Runtime | Owned scope | Output |
|---|---|---|---|
| API and booking foundation | GPT-5.6 Luna, max | `apps/api/**` | Executable FastAPI domain routes, PostgreSQL `0001`/`0002` schema, holds, bookings, clinical workflows, focused tests |
| Worker foundation | GPT-5.6 Luna, max | `apps/worker/**` | Durable PostgreSQL outbox poller/lease boundary, Celery transport, provider ports/fakes, focused tests |
| Frontend | Gemini Antigravity full-auto | `apps/web/**`, `pnpm-lock.yaml` | Patient/doctor/admin frontend with typed HTTP adapter and explicit deterministic demo mode |

The API lane must finish and integrate before auth/doctors or clinical-feature API tasks begin because those later tasks share API infrastructure and dependency metadata.

## Shared restrictions

- `AGENTS.md`, `PLAN.md`, and `docs/**` are read-only contracts.
- Root manifests and infrastructure are supervisor-owned unless a task explicitly grants one file.
- No lane merges, rebases, pushes, deploys, provisions services, or reads real user data.
- No real credentials or patient information.
- Each lane returns one bounded commit plus validation evidence.
- The supervisor independently reviews every commit before integration.

## Skill bundles

Each implementation task must read its assigned skill files completely before editing. Project contracts override generic skill advice.

### API and booking task

- `C:\Users\anshu\.agents\skills\python-fastapi-development\SKILL.md`
- `C:\Users\anshu\.agents\skills\database-design\SKILL.md`, plus `schema-design.md`, `indexing.md`, and `migrations.md` in the same directory
- `C:\Users\anshu\.agents\skills\postgresql\SKILL.md`
- `C:\Users\anshu\.agents\skills\api-design-principles\SKILL.md`, plus `resources\implementation-playbook.md`
- `C:\Users\anshu\.agents\skills\python-testing-patterns\SKILL.md`, plus `resources\implementation-playbook.md`

The API task follows the committed PostgreSQL 17 local target even if generic skill guidance mentions newer PostgreSQL capabilities.

### Worker-foundation task

- `C:\Users\anshu\.agents\skills\backend-architect\SKILL.md`
- `C:\Users\anshu\.agents\skills\python-patterns\SKILL.md`
- `C:\Users\anshu\.agents\skills\python-testing-patterns\SKILL.md`, plus `resources\implementation-playbook.md`

The worker task uses Celery/Redis as frozen in the project contract; generic framework-selection advice does not reopen that decision.

### Gemini Antigravity frontend lane

- `C:\Users\anshu\.agents\skills\antigravity-design-expert\SKILL.md`
- `C:\Users\anshu\.agents\skills\frontend-design\SKILL.md`
- `C:\Users\anshu\.agents\skills\baseline-ui\SKILL.md`
- `C:\Users\anshu\.agents\skills\nextjs-best-practices\SKILL.md`
- `C:\Users\anshu\.agents\skills\shadcn\SKILL.md` and its directly linked rules
- `C:\Users\anshu\.agents\skills\tailwind-design-system\SKILL.md` and `resources\implementation-playbook.md`
- `C:\Users\anshu\.agents\skills\fixing-accessibility\SKILL.md`

For frontend conflicts, precedence is: project contracts → accessibility and baseline constraints → Next.js/shadcn/Tailwind guidance → Antigravity decorative guidance. Spatial motion is restricted to public/auth surfaces.

## Phase 1 integration gates

- API and worker dependency lockfiles are committed within their owned application directories.
- Database migration and booking tests run against an isolated PostgreSQL service.
- Worker tests use deterministic fake adapters and do not call external providers; the
  durable poller is configured through `HEALTHCARE_WORKER_*` settings.
- Frontend build, lint, and type checks pass with the chosen HTTP or demo mode.
- Frontend status vocabulary matches `DOMAIN_RULES.md` and `API_CONTRACT.md`.
- No lane changes files owned by another lane.
