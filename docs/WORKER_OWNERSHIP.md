# Worker ownership

All implementation workers start from the same canonical commit in separate Git worktrees. They return one bounded commit and never merge their own work.

## Planned specialists

| Worker | Owns | Explicitly excludes |
|---|---|---|
| DB and booking | `apps/api/src/healthcare_api/modules/booking/**`, booking migrations/tests | Web, auth, integration adapters |
| Auth and doctors | auth, doctor, schedule, and leave modules/tests | Booking internals, web |
| LLM and visits | symptoms, summaries, visits, prescriptions modules/tests | Auth, booking internals |
| Integrations | `apps/worker/**`, API outbox dispatch boundary | Core booking transaction logic, web |
| Frontend | `apps/web/**` | API/database implementation, generated client internals |
| Client integration | OpenAPI generation and `packages/api-client/**` | Product UI redesign or API business logic |
| QA | Focused cross-service tests and evidence | Feature rewrites |
| Docs/deployment | README, deployment guides, CI/deploy configuration | Feature behavior |

## Shared-file policy

- `docs/**` is read-only for feature workers unless a contract-change task explicitly grants ownership.
- Root manifests are supervisor-owned.
- Alembic revisions are allocated before parallel database work to avoid competing heads.
- Generated client code is written only by the client integration owner.

## Required worker report

- Exact commit and parent
- Changed files
- Implementation summary
- Commands and validation results
- Generated or ignored state
- Residual risk
- Blockers or unverified assumptions
