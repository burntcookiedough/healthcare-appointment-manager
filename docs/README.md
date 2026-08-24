# Project documentation

These files are the shared contract between independently owned implementation areas.

- `ARCHITECTURE.md`: runtime boundaries, data flow, and deployment topology.
- `DOMAIN_RULES.md`: invariant identifiers and business rules.
- `API_CONTRACT.md`: endpoint-level contract and error conventions.
- `UI_SPEC.md`: portal information architecture and frontend handoff.
- `ACCEPTANCE_TESTS.md`: evaluator-focused behavior and failure-path checks.
- `WORKER_OWNERSHIP.md`: exact implementation scopes and integration order.

Contract changes require supervisor review because they can affect multiple workers.
