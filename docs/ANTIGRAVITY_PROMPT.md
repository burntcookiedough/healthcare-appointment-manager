# Gemini Antigravity frontend prompt

Paste the entire prompt below into Gemini Antigravity after opening the frontend worktree folder specified by the supervisor.

---

You are the sole frontend implementation environment for the Healthcare Appointment & Follow-up Manager. Work autonomously in full-auto mode until the bounded frontend assignment is complete. Do not ask routine questions; inspect the repository contracts, make reasonable in-scope decisions, implement, validate, self-review, and commit. Stop only for a genuine blocker that cannot be resolved inside your allowed scope.

## Repository and isolation

You are already inside a dedicated Git worktree on branch `codex/frontend-antigravity`. Confirm the branch and clean status before editing.

Your writable scope is strictly:

- `apps/web/**`
- `pnpm-lock.yaml`, only when changed by installing frontend dependencies

Everything else is read-only, including:

- `AGENTS.md`
- `PLAN.md`
- `docs/**`
- `apps/api/**`
- `apps/worker/**`
- `packages/api-client/**`
- all root configuration other than `pnpm-lock.yaml`

Never edit, format, rename, delete, or generate files outside the writable scope. Never merge, rebase, push, deploy, create another worktree, change branches, or modify Git history. Do not create sub-agents or delegate. Produce exactly one bounded commit when the work and validation are complete.

## Required skill files

Before editing, read each of these skill files completely. When a skill links a directly relevant rule or implementation playbook, read that too:

1. `C:\Users\anshu\.agents\skills\antigravity-design-expert\SKILL.md`
2. `C:\Users\anshu\.agents\skills\frontend-design\SKILL.md`
3. `C:\Users\anshu\.agents\skills\baseline-ui\SKILL.md`
4. `C:\Users\anshu\.agents\skills\nextjs-best-practices\SKILL.md`
5. `C:\Users\anshu\.agents\skills\shadcn\SKILL.md` and its `rules\styling.md`, `rules\forms.md`, `rules\composition.md`, `rules\icons.md`, `rules\base-vs-radix.md`, and `customization.md`
6. `C:\Users\anshu\.agents\skills\tailwind-design-system\SKILL.md` and `resources\implementation-playbook.md`
7. `C:\Users\anshu\.agents\skills\fixing-accessibility\SKILL.md`

Skill precedence is strict:

1. `AGENTS.md`, `PLAN.md`, and `docs/**`
2. accessibility and baseline constraints
3. Next.js, shadcn/ui, and Tailwind implementation guidance
4. frontend-design guidance
5. Antigravity spatial/decorative guidance

If the Antigravity skill recommends glassmorphism, isometric tilt, scroll hijacking, long transitions, or pervasive motion, do not apply those ideas to application or clinical surfaces. Use restrained spatial depth only on the public landing page and demo/login surface. Interaction feedback must stay within the baseline timing limits, and reduced-motion behavior is mandatory.

## Contracts to read before implementation

Read these files completely and treat them as authoritative:

1. `AGENTS.md`
2. `PLAN.md`
3. `docs/UI_SPEC.md`
4. `docs/API_CONTRACT.md`
5. `docs/DOMAIN_RULES.md`
6. `docs/ACCEPTANCE_TESTS.md`
7. `docs/ARCHITECTURE.md`

If a UI idea conflicts with a domain or API contract, follow the contract. Do not fix the disagreement outside `apps/web`; record it in your final report.

## Goal

Build a polished, responsive, production-quality frontend for patient, doctor, and
administrator experiences. Keep the typed API adapter as the single data boundary: it
must support the current FastAPI HTTP mode and an explicit deterministic demo mode while
the reviewed OpenAPI/Orval client gate remains pending.

Use:

- Next.js 15 App Router (the version pinned by `apps/web/package.json`/lockfile)
- React 19 and TypeScript with strict mode
- Tailwind CSS v4
- shadcn/ui and Radix primitives as the only component system
- Lucide icons
- TanStack Query
- React Hook Form and Zod
- date-fns
- Sonner
- Recharts only where a chart materially improves an admin view

Do not add Material UI, Chakra, Ant Design, Bootstrap, another design system, React Three Fiber, or a heavy animation framework. Prefer CSS transitions. Add a motion library only if it is small, justified, accessible, and used in more than one place.

## Visual direction

Use https://www.onassemble.com/ only as a visual-language reference. Do not copy its logo, wording, assets, illustrations, screenshots, font files, layout, or interaction sequence.

Translate these traits into an original healthcare product:

- near-white canvas and clean white surfaces
- bold compact black headings
- restrained pale acid-lime emphasis
- dark charcoal pill-shaped primary actions
- thin neutral calendar/grid lines
- generous whitespace
- large rounded work surfaces with subtle borders and diffused shadows
- a few original floating calendar, prescription, reminder, or message tokens on public/auth surfaces only
- spacious patient views, timeline-led doctor views, dense table-driven admin views

Keep clinical workflows calm and highly readable. Avoid large gradients, excessive cards, glassmorphism on content, stock medical illustrations, constant animation, isometric dashboard tilts, and decorative motion inside forms or clinical workspaces. Honor `prefers-reduced-motion` and WCAG 2.2 AA targets.

## Product structure

Implement a coherent public and authenticated demo experience:

- Public landing page with original healthcare copy and a scheduling-focused product preview
- Login/demo entry with an obvious synthetic role selector for Patient, Doctor, and Admin
- Patient dashboard
- Doctor discovery with search and specialization filters
- Doctor profile and availability
- Booking wizard: Doctor → Time → Symptoms → Review → Confirmation
- Active slot-hold countdown based on an absolute mocked `expires_at`, including expiry recovery
- Patient appointment list/detail and visit summary
- Medication reminder view
- Doctor daily timeline/dashboard
- Doctor appointment workspace with AI-assisted pre-visit brief clearly separated from original symptoms
- Visit notes and structured prescription editor
- Admin overview
- Doctor management and working-hours views
- Leave preview dialog showing affected appointments before confirmation
- Appointment operations
- Integration health for email, calendar, LLM, and reminder states

Use realistic synthetic Indian names and `Asia/Kolkata` display examples, but never use real patient data.

## Architecture inside `apps/web`

Use feature-based organization with thin routes. Keep these concerns separated:

- `src/app`: routes and layouts only
- `src/features`: patient, doctor, admin, booking, appointments, visits, prescriptions, integrations, auth/demo
- `src/components/ui`: reusable shadcn-style primitives
- `src/components/layout`: application shells and navigation
- `src/lib`: utilities, query provider, dates, accessibility helpers
- `src/mocks`: deterministic fixtures, mock handlers/repository, and scenario controls
- `src/types` or feature-local types: temporary contract-shaped frontend types

Create one frontend data-access boundary. Pages and components must not import fixtures directly. The mock implementation sits behind query/mutation functions shaped after `docs/API_CONTRACT.md`, so the later generated client can replace it. Do not invent alternate domain status values.

Provide a visible development-only scenario switcher or query-string mechanism for loading, empty, validation error, request error, offline, forbidden, success, retrying, partial integration failure, and expired-hold states. It must not look like a production control.

## Safety and correctness

- Use appointment statuses exactly as contracted: `confirmed`, `in_progress`, `completed`, `cancelled_patient`, `cancelled_doctor`, `cancelled_admin`, `cancelled_doctor_leave`.
- Keep integration status separate: `pending`, `succeeded`, `retrying`, `failed`.
- Keep generated-summary status separate and preserve original symptoms/notes when AI is unavailable.
- Never imply that availability is reserved before a hold exists.
- Derive the hold countdown from absolute server-style expiry, not a reset duration.
- Medication schedules derive only from structured prescription fields, never generated prose.
- Do not place symptom text, notes, prescription content, or tokens in URLs, analytics identifiers, console logs, or toast messages.
- Do not present AI output as diagnosis or clinician-authored content.
- Consequential dialogs must name the action, record, result, and affected appointments.

## Responsive and accessible behavior

- Complete keyboard access and visible focus
- Semantic headings, labels, tables, dialogs, error summaries, and live announcements
- Correct dialog focus trapping and restoration
- Minimum 44×44 CSS-pixel mobile targets
- No color-only statuses
- No clipped controls or page-level horizontal scrolling at 320 CSS pixels
- Usable at 200% zoom
- Reduced-motion mode removes floating/parallax motion without losing information
- Tables become labeled cards on small screens unless comparison truly requires contained horizontal scrolling

## Validation and completion

Install only required frontend dependencies. Keep the implementation within `apps/web/**` plus the generated `pnpm-lock.yaml` change. Then run the smallest complete validation set available, including:

- frontend formatting check
- ESLint
- TypeScript typecheck
- production build
- focused unit/component tests for hold countdown and at least one consequential workflow

Fix all errors in your scope. Inspect `git diff --check` and verify that no file outside the allowed scope changed. Commit exactly once with a clear message such as `feat(web): build healthcare portal experience`.

Your final report must contain:

- exact commit and parent
- changed files grouped by purpose
- implemented routes and major states
- commands and validation results
- dependencies added and why
- screenshots or preview instructions if available
- generated/ignored state
- residual risks, contract mismatches, or unverified assumptions

Do not claim a reviewed generated client, hosted deployment, or provider integration is
complete. This assignment ends with a complete frontend, explicit demo/HTTP mode
behavior, a passing production build, and one reviewable commit.

---
