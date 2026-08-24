# Worker task ownership

The sole supervisor is a GPT-5.6 Sol task at medium reasoning. Every worker is a separate, user-visible Codex task/thread running GPT-5.6 Luna at max reasoning. Collaboration sub-agents are not workers and are not used for project work. All implementation worker tasks start from the same canonical commit in separate Git worktrees. They return one bounded commit and never merge their own work.

Gemini Antigravity remains the dedicated frontend implementation environment and is not classified as a Codex worker task.

## Planned worker tasks and external frontend work

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
