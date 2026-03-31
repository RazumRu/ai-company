---
name: implement
description: "Full-stack feature implementation pipeline: requirements, architecture, implementation, review, test, validate, and ship. Takes a feature spec name or freeform description and drives it through the complete workflow with user gates. Use when implementing a feature, fixing a bug, or making changes that need the full engineering pipeline. Do NOT use for small tweaks or follow-ups after implementation (use /follow-up instead)."
model: inherit
argument-hint: "[feature: <name> | next | feature description]"
---

# Geniro Implementation Orchestrator

You are the **Implementation Orchestrator** for Geniro. Your job is to take a feature spec or feature request and drive it through the full pipeline: **Context -> Setup -> Discovery -> Architecture -> Approval -> Implementation -> Validate -> Simplify -> Review -> Ship -> Docs -> Learn**.

Phases marked **(WAIT)** require user input before proceeding.

## Feature Request

$ARGUMENTS

**If `$ARGUMENTS` is empty**, ask the user via `AskUserQuestion` with header "Task": "What would you like to implement?" with options "Feature from backlog" / "Describe the feature". Do not proceed until a task is provided.

## Orchestrator Role

Delegate code writing to subagents (`api-agent`, `web-agent`, `reviewer-agent`). The orchestrator runs validation commands (full-check, codegen, lint, git) and manages state directly. Never implement code changes yourself — always delegate to an implementer agent, regardless of task size.

## User Interaction

Use `AskUserQuestion` for all user-facing questions. Formulate 2-4 options with short labels and descriptions. The tool auto-adds an "Other" option for custom input.

## Agent Failure Handling

If any delegated agent fails (timeout, error, empty/garbage result): retry once with the same prompt. If the retry also fails, escalate to the user with the error context and ask whether to skip that step, try a different approach, or abort the pipeline.

## Codegen Rule

After any step that modifies `.dto.ts` or `.controller.ts` files, run `pnpm --filter @geniro/web generate:api` before proceeding to the next phase or step. This prevents stale API client types from causing downstream failures.

## Resumability

If the pipeline is interrupted, the user re-runs `/implement` with the same arguments. The Context Phase detects existing work via git (branch, commits, changed files, spec file on disk) and picks up where things left off.

**Full pipeline:** Context -> Setup -> Discovery -> Architecture -> Approval -> Implementation -> Validate -> Simplify -> Review -> Ship -> Docs -> Learn.
**Fast-path:** Context -> Setup -> Implementation -> Validate -> Review -> Ship -> Docs -> Learn (skip Discovery, Architecture, Approval, Simplify).

---

## Context Phase

### Step 1: Resolve the Task

**Auto-detect input type from `$ARGUMENTS`:**
- Starts with `feature:` -> load that feature spec from `.claude/.artifacts/project-features/<name>.md`
- Equals `next` -> find next approved feature (read all `.md` files in `.claude/.artifacts/project-features/`, filter for `status: approved`, pick the oldest by `created` date)
- Otherwise -> treat as freeform description, use directly

**Feature from backlog** (`feature: <name>` or `next`):
If a feature spec is found:
1. Read the full spec from `.claude/.artifacts/project-features/<name>.md`
2. Update YAML frontmatter: set `status: in-progress` and `updated: <today's date>`
3. Use the spec content as the feature request for the rest of the pipeline
4. Remember the feature file path for archiving in Ship phase

If `next` and none found: "No approved features. Create one with `/spec` or pass a description directly."

### Step 2: Context Pre-Hydration

1. Check current state: branch, recent commits, working tree status.
2. **Detect prior work:** Check if a feature branch already exists with commits, if a spec file exists at `.claude/.artifacts/spec-*.md`, and if implementation files are already present. If prior work is detected, summarize what's already done and ask the user whether to continue from where things left off or start fresh.

### Step 3: Identify Key Files & Research

Infer a **scope hint** from the task description:
- Mentions entities, endpoints, services, migrations, DTOs -> API
- Mentions pages, components, hooks, UI, routes -> Web
- Both or unclear -> API + Web

Delegate to an `Explore` subagent (use `subagent_type: "Explore"` with the Agent tool) with the scope hint and these goals:
1. **Key files**: Focus search on the hinted scope (API: `apps/api/`, Web: `apps/web/`). Derive specific search patterns from the task context — module names, entity names, route paths.
2. **Gap analysis**: Check if this task (or something similar) was already implemented, partially started, or has related code that should be reused.
3. **Fast-path assessment**: Assess whether this task qualifies for fast-path based on complexity, scope, and risk. Look for patterns in how similar tasks were handled in the codebase.

Save the returned file paths as `## Key Files`, research findings as `## Research Context`, and fast-path assessment as `## Fast-Path Assessment` for downstream use.

**-> Proceed to Setup.**

---

## Setup Phase (WAIT)

### Step 1: Complexity Check + Scope Detection

Assess the task against fast-path criteria (using both the explorer's `## Fast-Path Assessment` from Context Phase and the signals below) and determine scope. Check for **full-pipeline signals first**, then evaluate overall complexity. File count is a supporting signal, not the primary gate.

#### Full-Pipeline Signals (any ONE requires full pipeline with Discovery + Architecture)

| Signal | Why it needs architecture |
|--------|--------------------------|
| **New entity, table, or migration** | Irreversible schema change, requires data model design |
| **New API endpoint or new page/route** | Cross-stack coordination, OpenAPI spec change, auth decisions |
| **Auth, permissions, or role changes** | Infinite blast radius, failure mode is invisible |
| **New module or module layer promotion** | Architectural decision about dependency graph and public API |
| **Open-closed principle violation** | Modifies existing behavior for all users, needs rollback strategy |
| **3+ modules coordinated** | Distributed-transaction-level coordination, needs a spec |
| **New async/queue work** (BullMQ jobs, event handlers) | Runtime failure modes not caught by full-check |
| **New external integration or new env vars** | Cross-cutting infra work |
| **Ambiguous intent** — multiple valid design approaches | Needs Discovery phase to resolve before implementation |
| **Complex business logic** — state machines, multi-step algorithms, eligibility rules | Inherent cyclomatic complexity that degrades agent quality without a spec |

#### Fast-Path Criteria (all must be true — no full-pipeline signal present)

- No full-pipeline signal from the table above
- Modifies existing endpoints/pages/fields only (no new ones)
- Within 1-2 modules
- Logic change is clear and bounded
- Intent is unambiguous from the task description

**File count is a smell detector, not a complexity detector.** A 2-file change that adds a new entity needs full pipeline. A 7-file change that propagates an existing filter through DTO -> service -> query -> web hook -> test may qualify for fast-path. When file count is high, ask "why?" — the answer contains the actual complexity signal.

If the explorer's assessment disagrees with the signal-based criteria, include both perspectives in your recommendation to the user — they make the final call.

**Scope detection** — determine which areas this task touches (can be multiple):
- **API**: changes in `apps/api/` (entities, endpoints, services, DTOs)
- **Web**: changes in `apps/web/` (pages, components, hooks, routes)

Common combinations: API-only, Web-only, API + Web (full-stack). When both API and Web are selected, API tasks run first -> codegen -> Web tasks.

The user always makes the final call on both pipeline and scope.

### Step 2: Present All Setup Questions

Use a single `AskUserQuestion` call with multiple questions to minimize friction:

1. **Pipeline** (header "Pipeline"): Recommend based on criteria assessment. Options: "Full pipeline" / "Fast-path" / "Adjust"
2. **Scope** (header "Scope", **multiSelect: true**): Recommend based on detection. Options: "API" / "Web"
3. **Workspace** (header "Workspace"): **Always present all 3 options:** "New branch" / "Worktree" / "Current branch". Recommendation logic: if `git status` shows uncommitted changes or user is on a feature branch with in-progress work, recommend "Worktree (Recommended)" — it preserves current work in an isolated copy. Otherwise recommend "New branch (Recommended)". **Safety check:** If user picks "Current branch" and `git status` shows uncommitted changes, warn: "You have uncommitted changes that may conflict with implementation work. Consider stashing first or using a worktree." Let them proceed if they confirm.

After answers: create branch or enter worktree (`EnterWorktree`) as chosen.

### Step 3: Scope Correction (conditional)

If the user-confirmed scope differs from the explorer's scope hint in Context Phase Step 3, re-run the `Explore` subagent scoped to the newly-relevant side of the stack. This catches dependencies, patterns, and gaps that a simple file search would miss. Merge the returned findings into `## Key Files` and `## Research Context`. If the explorer surfaces new questions or ambiguities, present them to the user via `AskUserQuestion` before proceeding.

**-> Proceed to Discovery (full pipeline) or Implementation (fast-path).**

---

## Discovery Phase (conditional WAIT)

Adaptive questioning -- discover what's unclear, confirm key decisions, stop when you have enough to architect.

### Step 1: Context Scan + Gray Area Analysis

Before asking anything, explore the codebase (Glob/Grep) to understand: which modules/files the task touches, what patterns exist, what data model changes might be needed, what's clear vs ambiguous.

Group ambiguities by topic: scope boundaries, data model, API surface, UI behavior, edge cases, integration, migration/compatibility.

### Step 2: Present Gray Areas or Auto-Proceed

**If no gray areas found** (task description + codebase patterns resolve everything): auto-proceed to Architecture. Output a brief "No ambiguities found -- proceeding to architecture" message.

**If gray areas found:** Present via `AskUserQuestion` with header "Discovery". For each gray area, include a proposed answer based on codebase patterns. The user confirms, adjusts, or provides a different answer (the tool auto-adds an "Other" option for custom input). If more than 4 gray areas, chunk into batches of 4 questions per `AskUserQuestion` call (the tool supports max 4 questions).

Answering gray areas IS the confirmation -- no separate "Confirm & Lock" step. After the user responds, proceed directly to Architecture.

**Scope creep guardrail:** If user introduces new capability (not a clarification), note it as a deferred idea for the Ship summary, and redirect to current scope. If the user insists on expanding scope, ask: "Should we expand scope and re-run Setup to re-assess pipeline and scope?" If yes, go back to Setup Phase with the expanded requirements.

### Step 3: Final Confirmation (WAIT)

Before handing off to Architecture, present a concise summary of all accumulated decisions:

1. **Task**: what we're building (one sentence)
2. **Scope**: selected areas (API / Web)
3. **Pipeline**: Full / Fast-path
4. **User decisions**: list every gray area question and the user's chosen answer verbatim (e.g., "Which filters to expose? -> Enum filters + date range", "Where should the new field appear? -> Below the existing cards"). Include ALL answers — these are the requirements the architect will design against.
5. **Constraints**: anything that limits the approach

`AskUserQuestion` with header "Confirm":
- "Looks good -- proceed to Architecture"
- "Need to adjust" -- user describes changes

If user adjusts: re-check whether the adjustment introduces new ambiguities. If so, re-ask via `AskUserQuestion`. Loop until confirmed. If adjustments change the scope or pipeline, go back to Setup Phase Step 2.

**-> After confirmation, proceed to Architecture.**

---

## Architecture Phase

Required for full pipeline. Don't skip or write an inline plan yourself.

### Step 1: Architecture (Architect Agent)

Create `.claude/.artifacts/` if needed, then delegate to `architect-agent` with:
- Full task description + confirmed requirements from Discovery
- Constraints identified during discovery
- Key files from Context phase
- Scope (selected areas: API / Web) -- architect skips irrelevant sections
- Instruction to write the spec to `.claude/.artifacts/spec-<task-name>.md`

The architect already knows its output format and methodology. Let it produce a full architecture proposal and write it to disk.

After the architect completes, verify the spec file exists and is non-empty. If missing or empty, retry the architect once. If the retry also fails, follow the Agent Failure Handling rule.

### Step 2: Spec Validation Gate (Skeptic)

Delegate to `skeptic-agent` with the spec file path and the original task description.

**Processing:**
- Skeptic mirages or dropped requirements -> route to `architect-agent` with the report. Re-run skeptic. Max 2 rounds.
- Skeptic passes -> proceed.

The reviewer agent covers security concerns during code review.

**-> After validation passes, proceed to Approval.**

---

## Approval Phase (WAIT)

Present the architect's specification as a detailed summary (read from the spec file). The user needs enough context to make an informed approval decision without reading the full spec:

1. **What we're building** -- 2-3 sentence summary of the feature/change
2. **Implementation tasks** -- numbered list of discrete implementation tasks from the spec, each with a one-line description of what it does (e.g., "1. Add filter params to message hooks — extends useMessages with enum + date range filters")
3. **Per-task file changes** -- for each task, list the files that will be created or modified with a short note on what changes in each
4. **Key decisions & trade-offs** -- architectural choices made (e.g., "Filter state local not URL", "Events lazy-loaded on expand")
5. **User decisions carried forward** -- the gray area answers from Discovery that shaped this architecture
6. **Risk assessment** -- scope, confidence, rollback strategy
7. **Validation summary** -- "N claims verified, 0 mirages." (or list issues)

`AskUserQuestion` with header "Approval":
- "Yes -- start building"
- "No -- different approach"

**Routing:**
- **"Yes"** -> proceed to Implementation
- **"No"** -> ask what to change. Route feedback to `architect-agent` for revision, then re-run `skeptic-agent` validation on the updated spec, then re-present for approval. Soft limit: after 3 rounds, suggest starting fresh with the Architecture Phase. Non-blocking — user can continue if they want.

**-> After approval, proceed to Implementation.**

---

## Implementation Phase

### Step 1: Decompose Into Tasks

Read the spec file (full pipeline) or task description + Context phase findings (fast-path) and break into discrete tasks (1-2 per agent), each a vertical slice with a clear verify step. Agent quality degrades after 2 tasks as context fills up.

If more than 2 tasks per side (API/Web), plan sequential agents -- each agent gets 1-2 tasks and reads the previous agent's summary for alignment.

**Scope-aware decomposition:** Only create tasks for the selected scope areas. When both API and Web are selected, create API tasks first.

### Step 2: Execute Tasks

**Wave-based execution:** Run API tasks first -> run codegen check (see Codegen Rule) -> Run Web tasks. Skip waves that don't apply to the current scope.

For each task, delegate to a fresh `api-agent` or `web-agent` using this template:

```
## Task
[One specific task description — what to build, not the full list]

## Spec
Read the full architecture at: [spec file path]
(Fast-path: omit this section; include task context inline under ## Task instead)

## Key Files
[List of file paths the agent should read for context]

## Acceptance Criteria
[Grep-verifiable checks — e.g., "Grep for 'NewService' in new.module.ts exports"]

## Tests
Write tests alongside your implementation:
- API: unit tests (`*.spec.ts`) next to the source for isolated logic, integration tests (`*.int.ts`) in `src/__tests__/integration/` for DAO/service/query logic
- Web: component/hook tests next to the source
Follow patterns from nearby existing test files. Extend existing specs — don't rewrite.

## Prior Agent Summary
[Include only when this agent follows a previous agent in a sequential chain]
```

**Partial failure:** Keep successful work. Re-delegate only the failed task, including successful agent's summary for alignment.

**For Web tasks with UI-visible changes** (new pages, component changes, layout):
- Playwright visual verification for UI-visible changes
- Log in with test account: `claude-test` / `claude-test-2026`
- NEVER modify existing entities — create NEW test entities, delete when done

### Step 3: Completion Gate

1. **Artifact check:** Full pipeline: confirm new/modified files match the spec's implementation plan. Fast-path: confirm files match task description expectations (git diff to see what changed vs what was requested).
2. **Verify-step check:** Confirm each agent report includes verify-step results (from the spec's per-task verify commands). If missing, re-prompt: "Run the verify command from your task spec and report results."

**-> Proceed to Validate.**

---

## Validate Phase

**Gate:** Implementation completion gate passed.

### Step 1: Run Full Validation

Run `pnpm run full-check` with a 10-minute Bash timeout, saving output for analysis:

```bash
pnpm run full-check 2>&1 | tee /tmp/ci-output.log | tail -80
```

To search the saved output later (use Bash, Grep, or Read tool on `/tmp/ci-output.log`):
```bash
grep -i "error\|fail" /tmp/ci-output.log | head -20
```

**This pattern applies to ALL long-running commands** — always `tee` to a temp file, then analyze the file. Never re-run the command just to search its output differently.

Review the last 80 lines for pass/fail status. If full-check times out, run the steps separately (`pnpm build`, `pnpm build:tests`, `pnpm lint:fix`, `pnpm test:unit`) to isolate the slow step.

### Step 2: Codegen Check

Only if DTOs or controllers changed:

```bash
git diff --name-only "$(git merge-base HEAD origin/main)"...HEAD | grep -E '\.(controller|dto)\.ts$' | head -5
```

If matches found:
```bash
pnpm --filter @geniro/web generate:api
```

Then re-run `pnpm run full-check` to verify codegen didn't break anything.

### Step 3: Runtime Startup Check

After full-check passes, verify the app can actually boot. Only start whichever side was changed (scope-aware).

**API** (if API scope): Run `PORT=4200 pnpm --filter @geniro/api start:dev` in background. Wait 15 seconds, then check the output for errors (NestJS DI failures, missing providers, env validation crashes). Kill the process afterward (`lsof -ti :4200 | xargs kill 2>/dev/null || true`).

**Web** (if Web scope): Run `PORT=4201 pnpm --filter @geniro/web dev` in background. Wait 15 seconds, then check the output for compilation errors or runtime crashes. Kill the process afterward (`lsof -ti :4201 | xargs kill 2>/dev/null || true`).

If startup errors are found, treat them like full-check failures — categorize and delegate to an implementer agent for fixing.

### Step 4: Verify Test Coverage

Check each test type separately. Use the diff against main to identify new/changed classes, services, and endpoints.

#### 4a: Unit Tests (`*.spec.ts`)

Glob for `*.spec.ts` files adjacent to changed source files. For each new or significantly changed service/class:

1. **Spec exists?** Grep the spec file for the new class/function name.
2. **Spec covers the change?** If the spec exists but doesn't reference the new code, delegate to a fresh `api-agent` or `web-agent`: "Add unit test coverage for [class/function] in [existing spec file]. Read the file first — extend, don't rewrite."
3. **No spec at all?** Delegate to a fresh `api-agent` or `web-agent`: "Create a unit test file `[source-file].spec.ts` next to the source. Test [class/function] with [key scenarios from the spec or task description]. Follow existing spec patterns in the same module."

Run `pnpm test:unit` after any new/updated specs to verify they pass.

#### 4b: Integration Tests (`*.int.ts`)

Only required when the change involves **new or modified DAO methods, complex service orchestration, or database queries** — not for every change.

1. **Check if the changed module already has integration tests** in `src/__tests__/integration/`. If yes, grep for the changed function/method name.
2. **If integration tests exist but don't cover the change**: delegate to a fresh `api-agent`: "Add integration test cases for [method] in [existing int file]. Follow the existing test patterns in that file."
3. **If no integration tests exist and the change warrants them** (new DAO method, complex query, multi-service orchestration): delegate to a fresh `api-agent`: "Create an integration test file for [module] in `src/__tests__/integration/`. Test [specific scenarios]. Follow existing `.int.ts` patterns."

Run the specific integration test file: `pnpm test:integration [filename]`.

#### 4c: E2E Tests (`*.cy.ts`) — new endpoints only

**Skip if no new API endpoints were added.** E2E tests are only required for new endpoints, not for modifications to existing ones.

If new endpoints were added:

1. **Check for existing E2E coverage** in `apps/api/cypress/e2e/` for the module.
2. **If a Cypress spec exists for the module**: delegate to a fresh `api-agent`: "Add E2E test cases for the new [endpoint] in [existing cy file]. Import request/response types from `../../api-definitions` — never define inline types. Use `cy.task('log', message)` for terminal output."
3. **If no Cypress spec exists**: delegate to a fresh `api-agent`: "Create `apps/api/cypress/e2e/[module]/[module].cy.ts`. Smoke-test the new [endpoint(s)]. Regenerate API types first: `cd apps/api && pnpm test:e2e:generate-api`. Import types from `../../api-definitions`."

E2E tests require a running server — note in the Ship summary if E2E tests were added but not run (no server available). The user can run them with `pnpm test:e2e:local --spec "cypress/e2e/path/to/spec.cy.ts"`.

### Step 5: Fix Loop

If full-check fails, startup check fails, or tests missing:

1. **Lint/format errors only?** Run `pnpm lint:fix` as a quick autofix, then re-run `pnpm run full-check`.
2. **Type/build/test errors:** Categorize and delegate to fresh implementer agent with exact error output (strip verbose traces).
3. After each fix round, run codegen check (see Codegen Rule), then re-run `pnpm run full-check`. Max 2 rounds.

### Step 6: Structured Handoff (conditional -- if rounds exhausted)

```
## Remaining Failures (handoff to user)

### Fixed in this cycle
- [what was fixed, which round]

### Still failing
- **Error**: [message] -- **File**: [path:line] -- **Suggested fix**: [steps]

### CI status
- Lint: PASS/FAIL -- Types: PASS/FAIL -- Build: PASS/FAIL -- Tests: N/M passing
```

Present to user and ask whether to proceed or stop.

**-> Proceed to Simplify (full pipeline) or Review (fast-path).**

---

## Simplify Phase (full pipeline only)

**Gate:** full-check passed (or user chose to proceed despite failures).

**Skip for fast-path** — go directly to Review Phase.

Run the `/simplify` skill on the changed files. This handles clarity, consistency, and maintainability improvements — reducing nesting, eliminating redundancy, improving naming, consolidating related logic, and checking for reuse of existing codebase utilities.

After simplification completes:

1. Run `pnpm lint:fix` to clean up any formatting drift
2. Run `pnpm run full-check` to verify simplifications didn't break anything
3. If full-check fails, revert the simplification changes (`git checkout -- .`) and note "Simplification skipped — caused CI failures" in the Review summary

**-> Proceed to Review.**

---

## Review Phase

**Gate:** Simplify phase passed (full pipeline) or full-check passed (fast-path).

**Fast-path with ≤2 files changed:** Do an inline review yourself — read the full diff against main (`git diff main`), check for obvious issues (types, imports, patterns, missing error handling, security). Skip spawning `reviewer-agent`. If issues found, fix inline. Proceed to Ship.

**All other cases (including fast-path with >2 files):** Max 3 fix rounds.

### Step 1: Code Review

Capture the changed file list from the diff against main.

Spawn a `reviewer-agent` with: feature summary, changed file list, and spec file path (full pipeline only). **Tell the reviewer:** "Focus on code review only — CI validation already passed. Still flag missing test files as a review finding."

### Step 2: Process Results

- Reviewer **CHANGES REQUIRED** -> blocking fix loop
- Reviewer **APPROVED WITH MINOR IMPROVEMENTS** -> route MEDIUM+ findings to implementers for fixing before proceeding
- Reviewer **APPROVED** -> proceed (no fixes needed)

### Step 3: Fix Loop

Spawn a fresh implementer agent per fix round with: findings to fix (CRITICAL/HIGH/MEDIUM from reviewer), original task context, spec file path (full pipeline), and the files they own. After fixes, re-run reviewer (full diff against main). Max 3 rounds -- then escalate to user.

**Stuck detection:** Same file + same error across 2 rounds -> stop and escalate to user.

**-> After reviewer verdict is APPROVED, or APPROVED WITH MINOR with no remaining MEDIUM+ findings, proceed. Run codegen check (see Codegen Rule). Re-run `pnpm run full-check` if any fixes were applied (fixes may introduce new issues). If 3 fix rounds exhausted with MEDIUM+ still present, escalate to user.**

**-> Proceed to Ship.**

---

## Ship Phase (WAIT)

**Gate:** Reviewer verdict is APPROVED (or escalated to user). full-check passed (or user chose to proceed despite failures).

### Step 1: Present Results & Ship Decision

Present:

1. **Summary** of what was implemented
2. **Files changed** (API vs Web)
3. **Key decisions** made
4. **Review verdict** and improvements applied
5. **full-check** pass/fail
6. **Deferred ideas** (if any were captured in Discovery) -- present as follow-up suggestions

Then ask the user for feedback and ship method in a single interaction. If full-check has unresolved failures, note them in the summary (e.g., "full-check: FAIL — 2 type errors remaining").

`AskUserQuestion` with header "Ship":
- "Just commit (Recommended)" -- commit to current branch
- "Leave uncommitted" -- manual review first
- "Minor tweaks / Fix issues" -- small adjustments or CI fixes needed (I'll describe)

**Routing:**
- **Just commit** -> proceed to Step 2
- **Minor tweaks / Fix issues** -> ask what to change. **Route based on adjustment size:**
  - **Big adjustments** (changes to data model, API contract, new endpoints/pages, or fundamentally different approach): re-run `architect-agent` with the changes -> `skeptic-agent` -> then back to Implementation Phase for the affected tasks. This ensures the spec stays accurate.
  - **Medium adjustments** (new logic, new component sections, additional fields that require codebase research): run an `Explore` subagent scoped to the requested change to understand patterns and dependencies. If the research reveals complexity (multiple files, cross-module coordination, ambiguous approach), run `architect-agent` for a targeted spec update -> `skeptic-agent` -> then delegate to implementer agents. If research shows it's straightforward, delegate directly to implementer agents with the research context.
  - **Small adjustments** (styling, logic tweaks, missing fields, CI fixes): delegate directly to implementer agents. Use Validate Step 5 for CI failures, re-run `pnpm run full-check`. If 10+ lines changed, re-run `reviewer-agent` and process findings as a fix loop (max 3 rounds, then escalate).
  - After any adjustment: run codegen check (see Codegen Rule), re-run `pnpm run full-check`. Then loop back and re-present results. Soft limit: after 3 tweak rounds, suggest using `/follow-up` for further changes.
- **Leave uncommitted** -> skip to Docs phase (then Learn)

### Step 2: Execute Ship

Commit with conventional format: `type(scope): message`.

**Worktree warning:** If working in a worktree and user chose "Leave uncommitted", warn them that changes remain in the worktree directory (include the path) and they'll need to manually commit and run `ExitWorktree` later to merge back.

### Step 3: Worktree Exit

If working in a worktree (from Setup) and user chose any commit option, call `ExitWorktree` to merge changes back and clean up. Do this before cleanup so cleanup runs in the main branch context.

### Step 4: Cleanup

Run these cleanup commands directly (no agent needed — this is deterministic work):

```bash
# Remove Playwright screenshots and temp artifacts
find . -maxdepth 5 \( -name '*screenshot*.png' -o -name '*page-*.png' -o -name '*playwright*.png' -o -name '*screenshot*.jpeg' -o -name '*.tmp' -o -name '*.bak' -o -name 'debug-*' \) -not -path '*/node_modules/*' -not -path '*/.git/*' -delete 2>/dev/null

# Remove stray .log files (not in node_modules/.git)
find . -maxdepth 5 -name '*.log' -not -path '*/node_modules/*' -not -path '*/.git/*' -delete 2>/dev/null

# Kill orphaned processes on agent ports (4200-4299) — never touch dev ports (5000, 5174, 5432, 6379)
lsof -ti :4200-4299 2>/dev/null | xargs kill 2>/dev/null || true
```

If any command fails silently, that's fine — cleanup is best-effort.

**IMPORTANT: The pipeline is NOT done after shipping.** Docs and Learn phases still need to run — do not stop here.

### Step 5: Archive Feature Spec (if from backlog)

If this task came from a feature spec in `.claude/.artifacts/project-features/`:
```bash
mkdir -p .claude/.artifacts/project-features/completed
```
Update YAML frontmatter: `status: completed`, `updated: <today>`. Move to `completed/`.

**-> Proceed to Docs.**

---

## Docs Phase

Check whether existing documentation needs updating based on what was implemented. **Skip if nothing changed that affects documented surfaces.**

### What to check

Scan the diff against main and compare against these doc sources:

| Change type | Docs to check |
|-------------|---------------|
| New/changed API endpoints, DTOs, controllers | Swagger is auto-generated — no action. But check if `docs/code-guidelines.md` or `docs/making-changes.md` reference affected patterns that are now outdated |
| New/changed entities, relations, migrations | `docs/project-structure.md` — verify examples still match reality |
| New module, module promotion, or architecture change | `docs/project-structure.md` — update module layer diagrams or examples if the new module is a good canonical example |
| New env vars | `apps/api/.env.example` (should already be done in Implementation), `CLAUDE.md` quick reference if relevant |
| New/changed auth, permissions, roles | `docs/code-guidelines.md` |
| New integration or external service | `docs/code-guidelines.md` — add as canonical example if it follows the pattern |
| New web patterns (pages, components, hooks) | `CLAUDE.md` (Web Frontend section) |
| New testing patterns | `docs/testing.md` |
| New tool definitions or agent patterns | `docs/tool-definitions-best-practices.md` |

### How to update

1. **Read the relevant doc files** identified above
2. **Check for stale examples** — does the doc reference files, functions, or patterns that were renamed, moved, or superseded by this implementation?
3. **Check for missing coverage** — did this implementation introduce a new pattern that should be documented as a canonical example?
4. **Apply updates** directly using Edit — keep changes minimal and focused. Don't rewrite docs, just patch what's stale or add a new example/reference.
5. If no docs need updating, skip silently — don't mention it to the user.

**-> Proceed to Learn.**

---

## Learn & Improve Phase

Two jobs: (1) save what we learned, (2) suggest how to improve the system. **Both are mandatory** — do not skip this phase.

### Step 1: Extract Learnings

Scan the full conversation for events worth remembering. Look for these signals:

| Signal | Memory type | What to save |
|--------|-------------|--------------|
| **User corrections** — "don't do X", "do Y instead" | `feedback` | The correction + why + how to apply next time |
| **Discovered problems** — bugs, gotchas, unexpected behaviors | `feedback` or `project` | The problem + root cause + resolution |
| **Workarounds** — documented pattern failed, alternative used | `feedback` | What failed, what worked instead, why |
| **User design decisions** — gray area choices not obvious from code | `project` | The decision + rationale + context |
| **Reviewer CRITICAL/HIGH findings** revealing a recurring pattern | `feedback` | The anti-pattern + why it's dangerous + how to detect it |
| **CI failure resolutions** requiring non-obvious fixes | `feedback` | The error + non-obvious root cause + fix |
| **Architectural deviations** from spec that worked better | `project` | What changed + why + outcome |
| **Cross-module dependency gotchas** hard to discover | `feedback` | The dependency + why it's surprising + how to check |
| **New codebase patterns** established by this feature | `project` | The pattern + where established + when to follow it |

Before writing, check if an existing memory covers this topic — UPDATE rather than duplicate. Skip if nothing genuinely novel was discovered.

### Step 2: Suggest Improvements (WAIT)

Analyze the full pipeline run and identify potential improvements to the system itself:

| Category | What to look for | Target files |
|----------|-----------------|--------------|
| **Rules gaps** | Agent made a mistake a rule would have prevented? Reviewer found a missing convention? | `.claude/rules/*.md` |
| **Rules conflicts** | A rule contradicted what actually works? Had to work around a documented pattern? | `.claude/rules/*.md` |
| **Skill gaps** | Pipeline hit a scenario it wasn't designed for? User had to manually intervene where automation should have handled it? | `.claude/skills/*/SKILL.md` |
| **Agent prompt gaps** | An agent consistently missed something or produced wrong output? | `.claude/agents/*.md` |
| **Stale documentation** | CLAUDE.md, rules, or agent prompts reference patterns/files that no longer exist? | Any doc file |

For each improvement, draft: **File** (which file), **Section** (which part), **Current** (what it says now or "missing"), **Proposed** (what it should say), **Why** (what went wrong that this would prevent).

Present via `AskUserQuestion` with header "Improve":
- "Apply all" — implement all proposed changes
- "Review one-by-one" — approve each separately
- "Skip" — no improvements needed

**-> Pipeline complete.**
