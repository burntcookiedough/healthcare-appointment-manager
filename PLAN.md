# Healthcare Appointment & Follow-up Manager — Project Plan

## Objective

Build a reliable healthcare appointment and follow-up platform with separate patient, doctor, and administrator experiences. The frontend will be designed and implemented later in Gemini Antigravity; backend implementation will be coordinated here with bounded workers.

## Agreed stack

- Web: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- API: FastAPI, Pydantic v2, SQLAlchemy 2, Alembic
- Data: PostgreSQL; Supabase Auth with server-side RBAC
- Background work: Redis and Celery
- Contracts: FastAPI OpenAPI with an Orval-generated TypeScript client
- Integrations: provider-neutral LLM adapter, SendGrid, Google Calendar OAuth 2.0
- Hosting target: Vercel (web), Railway (API and worker), Supabase (PostgreSQL/Auth), Upstash (Redis)

## Repository boundaries

| Area | Owner during implementation | Purpose |
|---|---|---|
| `apps/web/**` | Gemini Antigravity frontend worker | Patient, doctor, and admin UI |
| `apps/api/**` | Backend specialists | HTTP API, RBAC, booking and clinical workflows |
| `apps/worker/**` | Integration specialist | Outbox processing, email, calendar, LLM, reminders |
| `packages/api-client/**` | Integration owner | Generated OpenAPI client; generated files are not hand-edited |
| `docs/**` | Supervisor/contracts owners | Frozen architecture and cross-team contracts |
| `infra/**` | DevOps owner | Local and hosted service definitions |

## Delivery phases

1. Foundation: architecture, domain rules, API contract, UI specification, acceptance tests, repository/tooling skeleton.
2. Core parallel implementation: booking/database, auth/doctors, worker infrastructure, mocked frontend design system.
3. Feature implementation: holds/bookings, schedules/leave, visits/prescriptions/LLM, email/calendar, full portal screens.
4. Integration: publish OpenAPI, generate client, replace frontend mocks, connect vertical flows.
5. Verification: concurrency, expiry, leave, RBAC, graceful-degradation, retries, responsive UI.
6. Deployment and handoff: environment docs, seed/demo data, diagrams, deployment instructions.

## Phase 0 exit criteria

- Root `AGENTS.md` and this plan exist.
- Repository layout and ownership are explicit.
- Architecture, domain, API, UI, and acceptance documents are reviewed.
- Local environment contract is documented without real secrets.
- No feature code is required in Phase 0.
- A canonical foundation commit exists before parallel implementation begins.

## Non-negotiable engineering decisions

- PostgreSQL is the source of truth for booking conflicts.
- Appointment creation and outbox creation occur in one transaction.
- Redis is never the authority for slot ownership.
- External integration or LLM failure cannot invalidate a committed appointment.
- Original patient symptoms and doctor notes are always preserved.
- Medication reminder schedules come from structured prescription fields, never generated prose.
- The frontend uses one component system: shadcn/ui with Tailwind and Radix primitives.

## Authorization boundary

This initialization phase creates structure, contracts, and tooling only. Feature implementation, external service provisioning, deployment, pull requests, merges, and releases are separate phases.
