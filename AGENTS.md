# AGENTS.md

## Operating Model

- Use one sole supervisor Codex task to coordinate the workflow, enforce boundaries, verify evidence, and communicate with the user.
- The supervisor runs GPT-5.6 Sol at medium reasoning.
- A worker is a separate, user-visible Codex task/thread created for a bounded assignment. Workers are not collaboration sub-agents.
- Every Codex worker task runs GPT-5.6 Luna at max reasoning. Do not use another model or reasoning level for a worker.
- The supervisor creates workers with the Codex thread/task tools, then reads and monitors those tasks with the thread coordination tools.
- Do not use collaboration sub-agents as project workers. Sub-agents are outside this project's operating model.
- Gemini Antigravity is the dedicated frontend implementation environment, not a Codex worker task.
- Only the supervisor may create, continue, stop, archive, or replace worker tasks.
- Workers must complete their assigned work themselves and must not create tasks, threads, or sub-agents or delegate further.
- Treat audit, implementation, pull request, merge, build, installation, and release as separate authorization boundaries.

## Project Discovery

Before changing anything:

- Read all applicable `AGENTS.md`, handoff, contribution, build, test, and release documentation.
- Identify the package manager, lockfiles, CI workflows, test commands, build scripts, release scripts, repository remotes, and default branch.
- Determine whether the working tree contains unrelated or user-owned changes.
- Resolve the user-approved branch, tag, or commit to an exact commit object.
- Use that exact commit as the canonical source for every parallel worker.
- Never mix branches, snapshots, untracked repository copies, or source from different commits.

## Supervisor Responsibilities

The supervisor owns:

- Canonical-source verification.
- Worker creation and scope assignment.
- Worktree isolation.
- Monitoring and scheduling.
- Finding verification and deduplication.
- Acceptance or rejection of worker commits.
- Pull-request and review gates.
- Merge authorization checks.
- Build and release verification.
- Worker archival and cleanup decisions.
- User-facing reports and authorization requests.

The supervisor must independently verify worker claims. Worker reports are evidence, not automatic approval.

## Worker Task Contract

Every worker task brief must define:

- Exact base commit.
- Assigned subsystem or issue.
- Owned files or permitted scope.
- Allowed commands and mutations.
- Explicitly forbidden actions.
- Required focused validation.
- Maximum acceptable scope.
- Required final-report fields.

Workers must:

- Remain inside their assigned scope.
- Avoid unrelated cleanup or refactoring.
- Use the smallest correct implementation.
- Run the smallest relevant existing checks.
- Add only focused regression coverage.
- Produce one bounded commit unless explicitly instructed otherwise.
- Never merge, release, publish, or delegate unless that is their assigned responsibility.

Final reports must include:

- Exact commit and parent.
- Changed files.
- Summary of the implementation.
- Commands and validation results.
- Generated or ignored state.
- Residual risk.
- Any blocker or unverified assumption.

## Parallel Worker Tasks

- Use separate worktrees for parallel workers.
- Root every worktree at the same exact canonical commit.
- Assign one independent concern per worker.
- Do not allow workers to edit a shared integration branch.
- Do not allow workers to merge their own changes.
- Keep parallel scopes disjoint whenever possible.
- Independently review each worker commit before integration.
- Deduplicate overlapping changes before cherry-picking.

## Read-Only Audit Phase

Audit workers must remain read-only unless the user explicitly authorizes implementation.

During an audit, workers must not:

- Edit source files.
- Install dependencies.
- Build or package the product.
- Launch the application.
- Push branches.
- Open or modify pull requests.
- Publish releases.
- Mutate runtime or user state.
- Inspect personal content.

Audit findings must include:

- Severity and confidence.
- Exact file and location.
- Relevant callers and contracts.
- Cleanup, failure, concurrency, and ownership paths.
- Existing test or documentation evidence.
- User-visible or operational impact.
- Minimal remediation direction.

The supervisor must classify every finding as:

- `accepted`
- `downgraded`
- `duplicate`
- `uncertain`
- `rejected`

Do not implement fixes until the audit has been synthesized and the implementation boundary is accepted.

## Implementation Policy

- Prioritize correctness, data safety, reliability, concurrency, and measured performance problems.
- Prefer minimal fixes over rewrites or re-architecture.
- Fix the product rather than building new scaffolding around it.
- Reject speculative abstractions and opportunistic cleanup.
- Route each accepted issue to the worker that owns the affected subsystem.
- Use at most the focused tests needed to demonstrate the bug and prevent its recurrence.
- Record useful lower-priority work as issue-ready text or repository issues when authorized.
- Do not mix unrelated medium- or low-priority improvements into high-priority fixes.

## Integration Branch

After specialist commits are accepted:

- Create a clean integration branch from the canonical base.
- Cherry-pick only independently accepted commits.
- Preserve a clear commit history.
- Resolve only direct integration conflicts.
- Run combined source validation.
- Push only the integration branch.
- Open a non-draft pull request.
- Verify the PR base, head, changed files, ancestry, and mergeability.

The integration worker may integrate, validate, push, and report. It must not implement newly discovered review findings.

## Automated Review and CodeRabbit

When CodeRabbit or another automated reviewer is configured:

- Require review coverage for the exact current PR head.
- A review of an older commit does not satisfy the review gate.
- Independently verify every finding against current source, callers, tests, and contracts.
- Accept genuine correctness findings.
- Reject speculative, cosmetic, documentation-style, or low-value churn.
- Do not treat an unresolved review thread by itself as proof that the current code is wrong.
- Route accepted corrections back to the appropriate original specialist.
- Review the correction commit before integrating it.
- Repeat the loop only for genuine regressions.

The integration worker must never fix review findings directly unless explicitly reassigned as a specialist.

## CodeRabbit Rate Limits

- Post no more than one manual review request per availability window.
- Never send duplicate review requests while one is pending.
- If CodeRabbit reports a cooldown, read the exact remaining duration.
- Schedule the next check for that duration, rounded up to the next whole minute.
- Do not poll every few minutes during a long cooldown.
- When the cooldown expires, send exactly one review request.
- While review is pending, use a slower monitoring cadence.
- Return to the normal cadence only when active work resumes.
- If review cannot run because the PR is closed or merged, report the blocker and use the least-mutating recovery authorized by the user.

## Merge Gate

Merge only when all required conditions are true:

- The PR is open and non-draft.
- The PR head is the exact expected commit.
- The base branch is correct.
- The PR is cleanly mergeable.
- The changed-file scope is verified.
- Required local validation passes.
- Required hosted CI checks pass.
- Exact-head automated review is complete.
- No accepted correctness finding remains unresolved.
- The user has authorized the merge.

Use expected-head protection when merging.

Preserve individual commits with a merge commit unless the repository explicitly requires another method. Do not squash, rebase, rewrite history, or merge early without authorization.

After merging, verify:

- Merge status.
- Merge commit.
- Merge parents.
- Commit ancestry.
- Remote default-branch head.

## Build Phase

Build only from the exact verified merge or release commit.

- Use a fresh isolated build location.
- Verify available disk space before starting.
- Keep the checkout, dependencies, runtime, caches, temporary files, logs, and outputs inside the verified build root.
- Use frozen dependency installation and documented build commands.
- Allow at most one evidence-backed retry.
- Do not silently change tracked source, lockfiles, versions, identity, or configuration during a build.
- Preserve failed build evidence until deletion is explicitly authorized.

Verify:

- Exact source commit.
- Tracked cleanliness.
- Product name and application identity.
- Version metadata.
- Runtime and ABI requirements.
- Dependency closure.
- Managed-service or deployment boundaries.
- Artifact names and sizes.
- SHA-256 and SHA-512 hashes.
- Artifact manifest.
- Third-party notices.
- Safe isolated smoke behavior.

## Release Phase

Treat build and publication as separate phases.

Before publication:

- Produce an explicit asset allowlist.
- Verify every artifact locally.
- Create an immutable annotated tag at the accepted release commit.
- Stop if the tag already exists or points elsewhere.
- Create a draft release first.
- Upload only the accepted assets.
- Verify release name, target, tag, notes, prerelease state, and latest-release state.
- Independently download every draft asset.
- Compare downloaded bytes and hashes against the accepted manifest.

Only after draft verification:

- Publish the unchanged draft.
- Preserve the intended prerelease and latest-release flags.
- Never silently replace assets.
- Never move a published tag.
- Never rebuild and substitute artifacts under the same version.

After publication, verify:

- Public release URL and release ID.
- Tag and peeled commit.
- Release name and state.
- Asset IDs, names, sizes, and digests.
- Public downloads and hashes.
- Updater metadata.
- Installer-to-payload resolution.
- Whether the stable/latest release pointer remained correct.

## Installation and Upgrade

Before changing an installed application:

- Inventory the installed product name, version, executable path, running processes, uninstall registration, and user-data location.
- Verify that the target is the intended product.
- Download only the approved official installer.
- Verify its expected size and cryptographic hash.
- Stop only verified application processes.
- Use the registered or documented uninstaller.
- Never recursively delete a guessed installation path.
- Preserve settings, history, models, and user data unless deletion is separately authorized.
- Do not weaken operating-system security controls to bypass an installer warning.

After installation, verify:

- Installed binary path.
- Product and application identity.
- Installed version.
- Uninstall registration.
- Process paths.
- Safe launch and health.
- Preservation of user data.

## Elastic Task Monitoring

Use a single bounded status snapshot per monitoring wake.

- Monitor workers through the Codex task/thread tools, not collaboration sub-agent tools.
- Pass each nonterminal worker task’s latest preserved cursor.
- Preserve every returned cursor for the next wake.
- Do not repeatedly read active workers.
- Do not wake merely because a worker posted commentary.
- If a worker is active, take no action.
- If a worker is idle with a substantive report, mark it terminal and never restart it.
- If a worker is idle without a substantive report, send exactly one continuation for the same bounded goal.
- Never send a duplicate continuation while the worker is active.
- Allow at most two continuation attempts per incomplete worker.
- A third incomplete completion is a genuine blocker.

Recommended elastic cadence:

- Active local work: approximately every 5 minutes.
- Passive CI or review: approximately every 10 minutes.
- Explicit external cooldown: exactly the reported duration, rounded up.
- Large transfer with measurable progress: widen the interval according to transfer rate.
- User interaction required: stop automatic retries and notify the user.
- Terminal completion or blocker: delete the schedule.

Update the schedule whenever the workflow changes phase.

## Worker Task Lifecycle

- Archive worker tasks after their output has been independently verified.
- Archive accidental, duplicate, stopped, completed, and obsolete worker tasks.
- Do not keep completed worker tasks active “just in case.”
- Reuse an existing specialist only when a correction belongs to its original scope.
- Do not restart terminal workers without a concrete, newly authorized correction.
- Preserve commits, reports, logs, and required evidence before archival.
- Delete obsolete monitoring schedules when work is complete or terminally blocked.

## User Communication

Notify the user only for:

- Substantive phase completion.
- A genuine blocker.
- A safety issue.
- Required authorization.
- Final verified completion.

Reports should lead with:

- Outcome.
- Exact commits, PRs, releases, or artifact URLs.
- Validation evidence.
- Accepted residual risk.
- The next authorization boundary.

Do not narrate unchanged monitoring snapshots. Do not claim success from worker reports alone; independently verify first.

## Commit Attribution

Follow the repository’s existing commit-attribution policy. Do not invent, replace, or alter author identity unless the project explicitly requires it.
