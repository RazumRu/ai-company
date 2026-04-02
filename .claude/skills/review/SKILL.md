---
name: review
description: "Review code changes in the Geniro codebase before they ship. Uses a multi-agent architecture: 5 focused sub-reviewers (bugs, security, architecture, tests, guidelines) run in parallel, then a judge pass deduplicates and scores findings. Catches bugs, AI-generated code anti-patterns, architectural drift, missing tests, security vulnerabilities (OWASP), test quality issues, and design system violations. Use after implementing a feature, before committing, or to review a specific branch."
context: fork
model: sonnet
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
argument-hint: "[what to review — e.g., 'recent changes', 'the graph revision service', branch name]"
---

# Code Review Pipeline

Review the following in the Geniro codebase, then fix all issues found (both new and pre-existing):

$ARGUMENTS

## Context

The Geniro platform is a monorepo with two apps:
- **apps/api/** — NestJS API backend (MikroORM, Vitest, Zod DTOs)
- **apps/web/** — React frontend (Vite, Ant Design, Refine, Socket.io)

## Your Role — Orchestrate, Don't Explore

You are a **coordinator**. You delegate the review to the `reviewer-agent` (which internally spawns 5 focused sub-reviewers in parallel) and fixes to `api-agent` / `web-agent`. You do NOT read source code or explore the codebase yourself.

## Architecture

The `reviewer-agent` uses a **multi-agent review grid**:
- 5 parallel sub-reviewers (bugs, security, architecture, tests, guidelines), each with a focused context window
- A judge pass that deduplicates, verifies, and confidence-scores all findings
- Only findings with confidence >= 70 are reported

This solves the attention degradation problem where a single reviewer misses issues in the middle of large diffs.

## Workflow

### Phase 1: Review

Delegate to the `reviewer-agent` via Task:

```
Review the following in the Geniro codebase:

$ARGUMENTS

The Geniro platform is a monorepo with two apps:
- **apps/api/** — NestJS API backend (MikroORM, Vitest, Zod DTOs)
- **apps/web/** — React frontend (Vite, Ant Design, Refine, Socket.io)

1. Identify what changed — use `git diff`, `git status`, or read the specific files/areas mentioned.
2. Spawn your 5 focused sub-reviewers in parallel (bugs, security, architecture, tests, guidelines).
3. Run the judge pass to deduplicate, verify, and score findings.
4. Also scan for pre-existing issues in the files you review — tag them [PRE-EXISTING].
5. Run `pnpm run full-check` independently to verify builds and tests pass.
6. Deliver a structured review with verdict, required changes, and minor improvements.

Be thorough but pragmatic. Catch real problems, propose practical fixes, approve when it's good enough to ship.
```

### Phase 2: Fix Issues

After the reviewer returns, check the verdict.

**If the reviewer returned APPROVED (no changes):**
- Report the clean review result to the user and stop.

**If the reviewer returned findings (required changes OR minor improvements):**

1. **Collect all fixable issues** — both required changes and minor improvements, both `[NEW]` and `[PRE-EXISTING]`.
2. **Group issues by app** — API issues (files in `apps/api/`) -> `api-agent`. Web issues (files in `apps/web/`) -> `web-agent`.
3. **Delegate fixes** to the appropriate agent(s). Launch API and Web agents in parallel if both have issues.

**Delegation template for API fixes:**
```
Work in the apps/api/ directory.

The code reviewer found the following issues that must be fixed:

## Issues to Fix
[paste ALL API-related issues from the reviewer — both required changes and minor improvements, include the file path, what's wrong, and the recommended fix]

## Requirements
- Fix ALL listed issues — do not skip any
- Run `pnpm run full-check` in geniro/ after fixing and resolve any failures
- Do NOT introduce new features or refactor beyond what the reviewer requested
- **MANDATORY DATA SAFETY RULE**: NEVER run `docker volume rm`, `podman volume rm`, `docker compose down -v`, `podman compose down -v`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or any command that removes local database data or Docker/Podman volumes
- After completing, report: files modified, full-check result, what was fixed
```

**Delegation template for Web fixes:**
```
Work in the apps/web/ directory.

The code reviewer found the following issues that must be fixed:

## Issues to Fix
[paste ALL Web-related issues from the reviewer — both required changes and minor improvements, include the file path, what's wrong, and the recommended fix]

## Requirements
- Fix ALL listed issues — do not skip any
- Run `pnpm run full-check` in geniro/ after fixing and resolve any failures
- Do NOT introduce new features or refactor beyond what the reviewer requested
- **MANDATORY DATA SAFETY RULE**: NEVER run `docker volume rm`, `podman volume rm`, `docker compose down -v`, `podman compose down -v`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or any command that removes local database data or Docker/Podman volumes
- After completing, report: files modified, full-check result, what was fixed
```

### Phase 3: Verify Fixes

After the implementing agent(s) complete fixes, **re-run the reviewer** to verify:

```
Re-review after fixes. This is review round 2.

## Previous Review Issues
[list of all issues from the first review]

## Fixes Applied
[summary of what each agent fixed, files modified]

## Files changed in this round
[list of files modified during fixes]

This is a re-review — only spawn sub-reviewers for dimensions that had findings in round 1. Verify that ALL previous required changes and minor improvements have been properly addressed. Check that fixes didn't introduce new issues.
```

**Review loop:**
- If the reviewer returns APPROVED -> proceed to Phase 4 (report)
- If the reviewer still has issues -> route fixes to agents again and re-review
- **Safety limit:** Max 3 fix rounds. If not resolved after 3 rounds, report the outstanding issues to the user.

### Phase 4: Report

Present the final result to the user:

1. **Original review verdict** and summary
2. **Issues found** — how many per dimension (bugs, security, architecture, tests, guidelines), new vs pre-existing
3. **Fixes applied** — what was changed and where
4. **Final verification** — build/test status after fixes
5. **Outstanding issues** (if any remained after the fix loop)
6. **Learnings** (if the reviewer flagged any)

## Important Notes

- **You are a router, not an explorer.** Do not read source code yourself. Delegate all work to the reviewer and implementing agents.
- **Fix everything.** Both required changes and minor improvements get fixed. Both `[NEW]` and `[PRE-EXISTING]` issues get fixed. The goal is to leave the code better than you found it.
- **MANDATORY DATA SAFETY RULE**: You and every delegated agent MUST NEVER run commands that remove local database data or Docker/Podman volumes.
- **Do not stop between phases.** After each agent returns, immediately proceed to the next phase.
