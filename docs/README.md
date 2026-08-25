# Project documentation

These files are the shared contract between independently owned implementation areas.
The current executable boundary is called out explicitly in [API_GUIDE.md](API_GUIDE.md).

- [`ARCHITECTURE.md`](ARCHITECTURE.md): runtime boundaries, data flow, reliability
  rules, and deployment topology.
- [`DOMAIN_RULES.md`](DOMAIN_RULES.md): stable invariants for booking, leave,
  ownership, clinical sources, LLM output, reminders, and auditability.
- [`API_CONTRACT.md`](API_CONTRACT.md): wire/error conventions and resource semantics;
  [`API_GUIDE.md`](API_GUIDE.md) is the executable route/status inventory.
- [`API_GUIDE.md`](API_GUIDE.md): current executable routes, auth/roles, frontend
  HTTP/demo adapter boundary, OpenAPI/client gate, and examples.
- [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md): executable `0001`/`0002` migration tables,
  constraints, ownership, and relationship diagram.
- [`LLM_PROMPTS.md`](LLM_PROMPTS.md): exact versioned prompts, structured output
  schemas, provenance/storage, and graceful failure behavior.
- [`INTEGRATIONS.md`](INTEGRATIONS.md): step-by-step Google OAuth/Calendar, SendGrid,
  and LLM provider setup without real secrets.
- [`DEPLOYMENT.md`](DEPLOYMENT.md): configured source manifests and a
  Vercel/Render/Railway-compatible deployment runbook; it does not claim a hosted URL.
- [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md): the under-800-word submission design.
- [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md): final evidence, scope/secret
  checks, and reproducible source archive command.
- [`UI_SPEC.md`](UI_SPEC.md): portal information architecture and frontend handoff.
- [`ACCEPTANCE_TESTS.md`](ACCEPTANCE_TESTS.md): evaluator-focused behavior and
  failure-path checks.
- [`WORKER_OWNERSHIP.md`](WORKER_OWNERSHIP.md): exact implementation scopes and
  integration order.
- [`IMPLEMENTATION_PHASE_1.md`](IMPLEMENTATION_PHASE_1.md): Phase 1 lane and gate
  description.
- [`ANTIGRAVITY_PROMPT.md`](ANTIGRAVITY_PROMPT.md): frontend handoff prompt.

Contract changes require supervisor review because they can affect multiple workers.
Deployment manifests and this documentation must be updated when a route, migration,
lockfile command, or provider boundary changes.
