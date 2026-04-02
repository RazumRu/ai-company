---
name: follow-up
description: "Lightweight change pipeline for small adjustments after /implement. Skips discovery and architecture - goes straight to implement, lint, test, and ship. Use for tweaks, fixes, style changes, or missing fields. Do NOT use for new features, new entities, new endpoints/pages, auth/permissions changes, or changes requiring architecture decisions (use /implement instead)."
model: inherit
argument-hint: "[description of what to change]"
---

# Follow-Up Change Pipeline

You are a **lightweight implementation orchestrator** for Geniro. This skill handles changes that don't need the full `/implement` pipeline — streamlined assessment, implementation, validation, review, and ship.

**Pipeline:** Assess -> Implement -> Validate -> Review -> Ship (includes Learn & Improve before commit)

Phases marked **(WAIT)** require user input before proceeding.

## AskUserQuestion

Every question to the user should use `AskUserQuestion`. Formulate 2-4 options with short labels and descriptions. The tool auto-adds "Other" for custom input.

## Agent Failure Handling

If any delegated agent fails (timeout, error, empty/garbage result): retry once with the same prompt. If the retry also fails, escalate to the user with the error context and ask whether to skip that step, try a different approach, or abort.

## Codegen Rule

After any step that modifies `.dto.ts` or `.controller.ts` files, run `pnpm --filter @geniro/web generate:api` before proceeding to the next phase. This prevents stale API client types from causing downstream failures.

## Change Request

$ARGUMENTS

**If `$ARGUMENTS` is empty**, ask the user via `AskUserQuestion` with header "Change": "What would you like to change?" with options "Describe the change" / "Fix a specific issue". Do not proceed until a change is provided.

---

## Phase 1: Assess

Determine what needs to change, how complex it is, and whether this skill can handle it.

### Step 1: Context Scan

1. **Read the change request** and identify which files likely need to change
2. **Codebase scan** (Glob/Grep) to find the exact files and understand current patterns
3. **Read the files** that will be modified — understand current state before changing anything
4. **Check current state:**
   ```bash
   git branch --show-current
   git log --oneline -5
   git status --short
   ```

### Step 2: Complexity Assessment

Assess the change by checking for **hard escalation signals first**, then evaluating overall complexity. File count is a supporting signal, not the primary gate.

#### Hard Escalation Signals (any ONE triggers escalation to /implement)

| Signal | Why it escalates |
|--------|-----------------|
| **New entity, table, or migration** | Irreversible schema change, requires architecture |
| **New API endpoint or new page/route** | Cross-stack coordination, OpenAPI spec change, auth decisions |
| **Auth, permissions, or role changes** | Infinite blast radius, failure mode is invisible |
| **New module or module layer promotion** | Architectural decision about dependency graph and public API |
| **Open-closed principle violation** | Modifies existing behavior for all users, needs rollback strategy |
| **3+ modules coordinated** | Distributed-transaction-level coordination, needs a spec |
| **New async/queue work** (BullMQ jobs, event handlers) | Runtime failure modes not caught by full-check |
| **New external integration or new env vars** | Cross-cutting infra work |
| **Ambiguous intent** — multiple valid design approaches | Needs Discovery phase to resolve before implementation |

#### Complexity Levels (when no hard escalation signal is present)

- **Trivial**: 1-2 files, single module, fix/patch to existing logic, intent is unambiguous. *Examples: fix a validation message, correct a query filter, adjust a CSS class.*
- **Small**: 3-5 files, 1-2 modules, modifies existing endpoints/pages/fields, clear bounded logic. *Examples: add a filter param to an existing endpoint + DTO + query + web hook, rename a response field across DTO and consumer.*
- **Medium**: 6-8 files, up to 2 modules, may add fields to existing entities (no new tables), non-trivial but clear logic. *Examples: add a column to an entity + migration + DTO + query + web table + test, change an existing calculation.*
- **Too large**: 9+ files, OR any hard escalation signal above. Escalate to `/implement`.

**File count is a smell detector, not a complexity detector.** A 2-file change that adds a new entity is "Too large." A 7-file change that propagates an existing filter through DTO -> service -> query -> web hook -> test is "Medium." When file count is high, ask "why?" — the answer contains the actual complexity signal.

### Step 3: Escalation Gate

**If complexity is "Too large":**

Present findings to the user:

> This change is larger than a follow-up:
> - [specific escalation signals detected]
>
> Recommend running `/implement [description]` for proper architecture and planning.

`AskUserQuestion` with header "Scope":
- "Escalate to /implement" — hand off to the full pipeline
- "Proceed anyway" — I understand the risk, keep going as follow-up
- "Reduce scope" — I'll narrow what I want changed

If user selects "Escalate to /implement": output the command `/implement [original change request]` and stop.
If user selects "Reduce scope": ask what to cut, re-assess, loop back to Step 2.
If user selects "Proceed anyway": continue — but enforce full validation and review (treat as Medium complexity).

**-> Proceed to Phase 2.**

---

## Phase 2: Implement

### Step 1: Plan (Medium complexity only)

For **Medium** complexity changes, write a brief implementation plan before coding:

1. List each file to change and what changes
2. Identify dependencies between changes (order matters)
3. Note any risks or things to verify

Present the plan to the user:

`AskUserQuestion` with header "Plan":
- "Looks good — proceed"
- "Adjust" — I want to change the approach

### Step 2: Execute

**Scope detection** — determine which side(s) to change:
- **API-only**: changes in `apps/api/`
- **Web-only**: changes in `apps/web/`
- **Both**: API first -> codegen check (see Codegen Rule) -> Web

**Trivial** (1-2 files, obvious fix): Implement directly using Edit/Write tools. No subagent needed.

**Small/Medium** (3+ files): Delegate to a fresh `api-agent` or `web-agent`:

```
## Task
[describe the specific change needed]

## Pre-Inlined Context
[paste the content of files you read in Phase 1 - save the agent from re-reading them]

## Codebase Conventions
Match existing patterns exactly. Find the closest existing example and follow it.

## Requirements
- Follow project rules in CLAUDE.md and docs/
- Do NOT run git add/commit/push - the orchestrator handles git
- Run `pnpm run full-check` after changes
- Report: files changed, what was done, any issues encountered
```

**-> After implementation, proceed to Phase 3.**

---

## Phase 3: Validate

### Step 1: Autofix

```bash
pnpm lint:fix 2>/dev/null || true
```

### Step 2: Full check

Run `pnpm run full-check` **once** and save output to a temp file:
```bash
pnpm run full-check 2>&1 | tee /tmp/ci-output.log | tail -80
```

To search the saved output later (use Bash, Grep, or Read tool on `/tmp/ci-output.log`):
```bash
grep -i "error\|fail" /tmp/ci-output.log | head -20
```

**This pattern applies to ALL long-running commands** — always `tee` to a temp file, then analyze the file.

### Step 3: Codegen check

Only if DTOs or controllers changed:

```bash
git diff --name-only "$(git merge-base HEAD origin/main)"...HEAD | grep -E '\.(controller|dto)\.ts$' | head -5
```

If matches found:
```bash
pnpm --filter @geniro/web generate:api
```

Then re-run `pnpm run full-check` to verify codegen didn't break anything.

### Step 4: Runtime Startup Check (Medium complexity only)

Verify the app can boot. Only start whichever side was changed:

**API** (if API scope): Run `PORT=4200 pnpm --filter @geniro/api start:dev` in background. Wait 15 seconds, check output for errors (NestJS DI failures, missing providers). Kill afterward (`lsof -ti :4200 | xargs kill 2>/dev/null || true`).

**Web** (if Web scope): Run `PORT=4201 pnpm --filter @geniro/web dev` in background. Wait 15 seconds, check for compilation errors. Kill afterward (`lsof -ti :4201 | xargs kill 2>/dev/null || true`).

If startup errors found, treat like full-check failures — fix and re-validate.

### Step 5: Test Coverage Check (Small/Medium complexity)

Check each test type based on what changed. Use `git diff --name-only` against main to identify changed files.

#### Unit Tests (`*.spec.ts`)

1. **Find spec files** adjacent to changed source files (Glob for `*.spec.ts` near each changed file)
2. **Grep** existing specs for the changed function/class names
3. **If spec exists but doesn't cover the change**: delegate to a fresh `api-agent` or `web-agent`: "Add unit test cases for [function/class] in [existing spec file]. Extend, don't rewrite."
4. **If no spec exists and non-trivial logic changed** (not just a field rename or style fix): delegate to a fresh `api-agent` or `web-agent`: "Create `[source-file].spec.ts` next to the source. Test [function/class] with [key scenarios]. Follow existing spec patterns in the same module."

Run `pnpm test:unit` after any new/updated specs.

#### Integration Tests (`*.int.ts`) — only if DAO/query/multi-service logic changed

1. **Check** `src/__tests__/integration/` for existing tests covering the changed module
2. **If tests exist but don't cover the change**: delegate to a fresh `api-agent`: "Add integration test cases for [method] in [existing int file]."
3. **If no tests exist and the change warrants them** (new DAO method, complex query): delegate to a fresh `api-agent` to create one. Run with `pnpm test:integration [filename]`.
4. **If the change is minor** (field addition, filter tweak) and existing integration tests pass: skip — note in Ship summary if you think integration coverage should be expanded later.

### Step 6: Fix Loop

If full-check fails, startup check fails, or tests fail:

1. **Lint/format errors only?** Run `pnpm lint:fix`, then re-run `pnpm run full-check`
2. **Type/build/test errors:** Fix directly (Trivial) or delegate to fresh implementer with exact error output
3. After each fix round, run codegen check (see Codegen Rule), then re-run `pnpm run full-check`
4. **Max 2 fix rounds** — then present structured handoff to user:

```
## Remaining Failures

### Fixed
- [what was fixed, which round]

### Still failing
- **Error**: [message] — **File**: [path:line] — **Suggested fix**: [steps]

### CI status
- Lint: PASS/FAIL — Types: PASS/FAIL — Build: PASS/FAIL — Tests: N/M passing
```

**-> After validation passes, proceed to Phase 4.**

---

## Phase 4: Review (Small/Medium complexity)

**Skip for Trivial changes** (1-2 files, obvious fix) — go directly to Phase 5.

### Step 1: Code Review

Capture the changed file list from the diff against main.

Spawn a `reviewer-agent` with: change summary and changed file list. **Tell the reviewer:** "This is a follow-up change — focus on correctness and regressions. CI already passed. Keep review proportional to change size."

### Step 2: Process Results

- Reviewer **CHANGES REQUIRED** -> fix loop: delegate to implementer, re-validate (Phase 3 Step 2 only — skip autofix/startup), re-review. Max 1 fix round for follow-ups.
- Reviewer **APPROVED WITH MINOR** -> note improvements in Ship summary. Only fix MEDIUM+ findings — delegate to implementer if any, then proceed.
- Reviewer **APPROVED** -> proceed directly.

**-> Proceed to Phase 5.**

---

## Phase 5: Ship (WAIT)

Show a summary:

**Done. Here's what changed:**
- [file]: [what changed]
- full-check: PASS/FAIL
- Review: [verdict] (or "skipped — trivial change")
- Test coverage: [covered / gaps noted / tests added]

### Step 1: Review Gate (loop entry point)

`AskUserQuestion` with header "Review" and options:
- "Looks good" — I'm happy with the changes
- "Needs tweaks" — I want small adjustments (I'll describe)
- "Done" — leave uncommitted, I'll handle it myself

**If "Needs tweaks":**
1. Ask what to change
2. **Assess the tweak** — if it's another small fix, apply it directly. If it expands scope significantly (new files, new endpoints), warn:
   > "This is growing beyond follow-up scope. Want to continue here or escalate to `/implement`?"
3. Apply changes (directly or via agent)
4. Re-run validation (Phase 3 Step 2 only)
5. If 10+ lines changed, re-run reviewer (Phase 4). Max 1 review round for tweaks.
6. **Loop back to Step 1** — re-present summary and ask the Review question again. Do NOT skip ahead to Step 2.
7. Soft limit: after 3 tweak rounds, suggest creating a new `/follow-up` or `/implement` for remaining changes.

**If "Done":** Leave changes uncommitted, skip to cleanup.

**If "Looks good":** Proceed to Step 2.

### Step 2: Learn & Improve

Two jobs: save what we learned, suggest improvements. **Skip entirely for Trivial changes** (1-2 files, obvious fix). This runs BEFORE committing so that doc/rule changes are included in the commit.

#### Extract Learnings

Scan the conversation for:
- **User corrections** — "don't do X", "do Y instead" -> save as `feedback` memory with the correction, why, and how to apply
- **Discovered problems** — bugs, gotchas, unexpected behaviors -> save as `feedback` or `project` memory
- **Workarounds** — when a documented pattern failed -> save as `feedback` memory (what failed, what worked, why)
- **CI failure resolutions** that required non-obvious fixes -> save as `feedback` memory

Before writing, check if an existing memory covers this topic — UPDATE rather than duplicate. Skip if nothing novel was discovered.

#### Suggest Improvements (WAIT)

**Skip for Small changes** — only run for Medium complexity or "Proceed anyway" escalated changes.

Check if the pipeline run revealed:
- **Rules gaps** — agent made a mistake a rule would have prevented
- **Rules conflicts** — a rule contradicted what actually works
- **Stale documentation** — rules reference patterns/files that no longer exist

For each improvement, draft: which file, what to change, why.

`AskUserQuestion` with header "Improve":
- "Apply all" — implement proposed changes
- "Review one-by-one" — approve each separately
- "Skip" — done

### Step 3: Ship Decision

**Only reach this step when the user explicitly chose "Looks good" in Step 1.** Never auto-commit — always ask.

`AskUserQuestion` with header "Ship" and options:
- "Commit" — add to current branch (includes all changes: implementation + docs + rule updates)
- "Commit + push" — commit and push to remote
- "Leave as-is" — don't commit, I'll handle git myself

**Commit message format:** Follow conventional commits:
```
fix(module): description of what changed
```

### Cleanup

```bash
# Kill orphaned processes on agent ports — never touch dev ports
lsof -ti :4200-4299 2>/dev/null | xargs kill 2>/dev/null || true
```

**-> Pipeline complete.**

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| full-check fails after 2 fix rounds | Agent is stuck on the same error | Present error to user with structured handoff |
| Change is larger than expected | Scope grew beyond follow-up | Escalate to `/implement` |
| Codegen not detected | Controller/DTO changes not showing in diff | Run `pnpm --filter @geniro/web generate:api` manually if API surface changed |
| Agent re-reads files already scanned | Pre-inlined context was not passed | Always paste file contents from Phase 1 into the agent delegation prompt |
| Reviewer finds architectural issues | Change needs design work | Escalate to `/implement` with reviewer findings as context |
