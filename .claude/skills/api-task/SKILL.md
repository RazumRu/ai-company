---
name: api-task
description: "Execute a backend task in the Geniro API monorepo (NestJS). Use for creating endpoints, services, DAOs, entities, DTOs, writing tests, fixing backend bugs, or modifying business logic."
context: fork
agent: api-agent
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Task
argument-hint: "[task description]"
---

# API Task

Execute the following task in the **geniro/** monorepo:

$ARGUMENTS

## Before Starting

1. Read `geniro/docs/code-guidelines.md` and `geniro/docs/project-structure.md` for coding standards.
2. Read `geniro/docs/testing.md` for testing rules.
3. Search for related files using Glob/Grep to understand existing patterns.

## MANDATORY DATA SAFETY RULE

NEVER run `docker volume rm`, `podman volume rm`, `docker compose down -v`, `podman compose down -v`, `DROP TABLE`, `DROP DATABASE`, `TRUNCATE`, or any command that removes local database data or Docker/Podman volumes. The local PostgreSQL database and all container volumes are untouchable. This rule has no exceptions.

## After Completing

### Step 1: Run full-check
```bash
cd geniro && pnpm run full-check
```
Fix any issues and re-run until it passes.

### Step 2: Discover, write, and run ALL related integration tests
- **Discover related tests** — search `src/__tests__/integration/` for existing test files that cover the feature modules you modified:
  ```bash
  find src/__tests__/integration/ -name "*.int.ts" | grep -i "<feature>"
  grep -rl "YourChangedService\|YourChangedDao" src/__tests__/integration/
  ```
- **Create/update integration tests** (`.int.ts`) in `src/__tests__/integration/<feature>/` if none exist or existing tests don't cover the new/changed behavior
- Test the complete business workflow through direct service calls: happy path + 2-3 edge/error cases
- Follow existing patterns in `src/__tests__/integration/` (use `createTestModule` from `setup.ts`)
- **Run EVERY related integration test file individually** — not just the ones you created:
  ```bash
  cd geniro && pnpm test:integration src/__tests__/integration/<feature>/<test>.int.ts
  ```
- **The task is NOT done until ALL related integration tests pass.**

### Step 3: Archive completed feature (if from backlog)

If `$ARGUMENTS` references a feature from `.generated/project-features/` (e.g., starts with `feature:` followed by a name), archive it after successful completion:

1. Find the feature file: `.generated/project-features/<name>.md`
2. Update YAML frontmatter: set `status: completed` and `updated: <today's date>` using the Edit tool
3. Move to completed:
   ```bash
   mkdir -p .generated/project-features/completed
   mv .generated/project-features/<name>.md .generated/project-features/completed/<name>.md
   ```

Skip this step if the task is not from the feature backlog (ad-hoc description).

### Report back with:
- Files created/modified
- Key decisions made
- Unit test results (`pnpm run full-check` pass/fail + test count)
- Integration tests: ALL related test files discovered, which were run, which were created/updated, and pass/fail results for each
- Feature archived (yes/no — which feature was moved to completed/)
- Any issues or follow-ups
