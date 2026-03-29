---
name: refactor
description: "Analyze code for smells and improvement opportunities, then implement safe, incremental refactoring with continuous test verification. Supports extract/rename/move/split/deduplicate transformations in geniro/ (NestJS) and geniro/apps/web/ (React). Zero behavior change guaranteed."
context: fork
agent: refactor-agent
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
  - WebSearch
argument-hint: "[what to refactor — e.g., 'geniro/src/graphs/graph.service.ts is too large', 'rename UserDto to UserResponseDto', 'extract revision logic from the graph service']"
---

# Refactor

Analyze and refactor the following in the Geniro codebase:

$ARGUMENTS

## Context

The Geniro platform consists of two repositories:
- **geniro/** — NestJS API backend (MikroORM, BullMQ, Socket.IO, Zod DTOs)
- **geniro/apps/web/** — React frontend (Vite, Ant Design, Refine, @xyflow/react)

## Your Task

1. **Read project standards** — `geniro/docs/code-guidelines.md`, `geniro/docs/project-structure.md` for API; `geniro/apps/web/claude.md` for Web.
2. **Analyze the target code** — identify all code smells (structure, duplication, naming, architecture).
3. **Plan the refactoring** — produce an ordered list of incremental, safe steps. Present and wait for user confirmation on HIGH RISK steps.
4. **Implement each step** — make one logical change at a time, run `pnpm run full-check` after each, revert if tests break.
5. **Verify the final state** — run full-check one last time. Confirm all tests pass and no behavior changed.

## MANDATORY DATA SAFETY RULE

NEVER run `docker volume rm`, `podman volume rm`, `docker compose down -v`, `podman compose down -v`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or any command that removes local database data or Docker/Podman volumes. Local data is untouchable. This rule has no exceptions.

## Completion Report

After completing, report:
- Smells detected and addressed
- Steps completed (with pass/fail per step)
- Files changed and metrics (lines added/removed)
- Anything deferred (with reason)
- Final full-check result
