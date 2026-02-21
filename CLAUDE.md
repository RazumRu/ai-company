# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Authoritative docs

The `/docs` directory is the single source of truth for architecture, style, and process rules. Read the relevant files there before writing or changing code. This file is a condensed version for quick reference.

---

## Commands

All commands run from the **repo root** unless noted otherwise.

**⚠️ IMPORTANT**: Before running any commands, always run `pnpm install` first to ensure all dependencies are installed.

### Daily development
```bash
pnpm install                          # Install dependencies
pnpm deps:up                          # Start local services (Podman: Postgres, Redis, Qdrant, Keycloak, LiteLLM)
cd apps/api && pnpm start:dev         # Dev server with hot-reload (port 5000)
```

### Build & lint
```bash
pnpm build                            # Full monorepo build (Turbo)
pnpm build:tests                      # Compile test files (run after build)
pnpm lint:fix                         # Auto-fix lint + formatting
pnpm lint                             # Lint without fixing (to see remaining issues)
```

### Testing

**⚠️ CRITICAL**: Always use the `pnpm run` / `pnpm` package.json scripts to run tests. Never call test runners directly (e.g. `vitest`, `npx vitest`). Never run full test suites — always target specific files.

```bash
# ✅ CORRECT — always use package.json scripts
pnpm test:unit                        # Vitest unit tests (*.spec.ts) — mandatory
pnpm test:integration {filename}      # Run ONLY the related integration test file

# ❌ WRONG — never call test runners directly
# vitest run
# npx vitest
# pnpm vitest run

# ❌ WRONG — NEVER run full test suites
# pnpm test                           # runs everything — FORBIDDEN
# pnpm test:integration               # runs ALL integration tests — FORBIDDEN

# ⚠️  NEVER run bare `pnpm test:integration` without a filename — always target the specific file

# E2E (Cypress) — requires server running + deps up:
cd apps/api
pnpm test:e2e:generate-api            # Regenerate API types from Swagger (do this before E2E runs)
pnpm test:e2e:local --spec "cypress/e2e/path/to/spec.cy.ts"   # Single spec (preferred for iteration)
pnpm test:e2e:local                   # Full E2E suite (only for final verification)
```

### Mandatory before finishing any work
```bash
pnpm run full-check                   # build + build:tests + lint:fix + unit tests — must pass
```

### Database
```bash
cd apps/api
pnpm run migration:generate           # Auto-generate migration from entity changes — NEVER hand-write migrations
pnpm migration:revert                 # Revert last migration
pnpm seed:create                      # Create a new seed file
pnpm seed:run-all                     # Run all seeds in timestamp order
```

### Commits
```bash
pnpm commit                           # Conventional commit via commitizen (type(scope): message)
```

### Script flag note
Never use `--` as a separator when running pnpm scripts. Pass flags directly:
```bash
# ✅  pnpm test:e2e:local --spec "path"
# ❌  pnpm test:e2e:local -- --spec "path"
```

---

## Architecture overview

This is a **pnpm + Turbo monorepo**. The single application lives in `apps/api` (NestJS on Fastify). Shared libraries live in `packages/`.

```
apps/api/src/
├── main.ts                   # Entry point
├── app.module.ts             # Root NestJS module
├── v1/                       # Feature modules (see below)
├── db/
│   ├── migrations/           # Auto-generated TypeORM migrations
│   ├── seeds/                # Seed files (timestamped, run in order)
│   └── typeormconfig.ts
├── environments/             # Env loading (dotenv)
├── utils/                    # Shared utilities
└── __tests__/integration/    # Integration tests (*.int.ts)

packages/
├── common/      # Logger (Pino+Sentry), custom exception classes, bootstrapper
├── http-server/ # Fastify setup, Swagger, auth (Keycloak), middleware, request tracing
├── metrics/     # Prometheus integration
├── typeorm/     # TypeORM config wrapper, BaseDao, migration/seed CLI utilities
└── cypress/     # Cypress helpers + API type generator (cy-generate-api)
```

### Layered architecture (per feature)

Each feature in `src/v1/<feature-name>/` follows a strict layer structure:

```
Controller  →  Service  →  DAO  →  Entity  →  PostgreSQL
(HTTP/validation)  (business logic)  (queries)  (ORM mapping)
```

```
src/v1/feature-name/
├── dto/                    # Zod-backed DTOs (all in one file per module)
├── entities/               # TypeORM entities
├── feature.controller.ts
├── feature.service.ts
├── feature.dao.ts
└── feature.module.ts
```

- **Controllers** are thin: route + validate only.
- **Services** own business logic and orchestrate DAOs.
- **DAOs** use generic filter-based `find()` methods with a filters interface — avoid proliferating `findByX` methods. Only add specific methods when they involve complex joins/relations.
- **DTOs** use Zod schemas with `createZodDto()` from `nestjs-zod`. Keep all DTOs for a module in a single file.
- **Entities** are plain TypeORM-decorated classes. Schema changes must go through `migration:generate`.

### Key modules in `src/v1/`

| Module | Role |
|---|---|
| `graphs` | Core: graph CRUD, execution lifecycle, versioning, schema compilation |
| `agents` | LangGraph-based agent runtime |
| `agent-tools` | Tool implementations: web search, shell, file ops, GitHub, codebase search |
| `agent-triggers` | Trigger execution (e.g. manual) |
| `threads` | Thread/message/checkpoint persistence |
| `graph-templates` | Pluggable node template registry |
| `runtime` | Docker-based isolated execution (Dockerode) |
| `notifications` | Socket.IO WebSocket event broadcasting |
| `knowledge` | Vector embeddings + semantic search (Qdrant) |
| `litellm` | LLM proxy integration |
| `git-repositories` | GitHub repo management (Octokit) |
| `agent-mcp` | Model Context Protocol server integration |
| `cache` | Redis caching layer |
| `qdrant` | Qdrant client wrapper |

### Cross-cutting infrastructure

- **Auth**: Keycloak-backed. `AuthContextService` provides the current user. Dev-mode bypass available via `AUTH_DEV_MODE=true`.
- **Real-time**: Socket.IO for pushing graph/thread lifecycle events to clients.
- **Task queue**: BullMQ (Redis) for async work like revision processing and knowledge reindexing.
- **Observability**: Pino structured logging, Prometheus metrics at `/metrics`, optional Sentry.
- **Vector search**: Qdrant stores knowledge chunk embeddings; queries use `text-embedding-3-small` via LiteLLM.
- **LLM routing**: All model calls go through a local LiteLLM proxy (port 4000). Supports OpenAI, and Ollama for offline use.

---

## Coding conventions

- **No `any`** — use specific types, generics, or `unknown` + type guards.
- **No inline imports** — all imports at the top of the file.
- **Naming**: PascalCase for classes/interfaces/enums/types; camelCase for variables/functions; PascalCase for enum members.
- **Errors**: Throw custom exceptions from `@packages/common` (e.g. `NotFoundException`, `BadRequestException`). Never swallow errors silently.
- **Migrations**: Always `pnpm run migration:generate`. Never hand-write or use `migration:create`.
- **Generated files**: Never manually edit `cypress/api-definitions/` — regenerate with `pnpm test:e2e:generate-api`.
- **Imports**: Shared packages are aliased as `@packages/*` (e.g. `import { … } from '@packages/common'`).
- **Agent tool definitions**: All tools in `agent-tools/` must follow the best practices in `/docs/tool-definitions-best-practices.md` and the [official Anthropic tool use guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions). Descriptions must be detailed (3-4+ sentences), parameters must have clear `.describe()` strings, and `getDetailedInstructions()` must carry all heavy guidance. Read the docs file before creating or modifying any tool.
- **Tool and agent instructions must be generic**: Tool descriptions, `getDetailedInstructions()`, subagent system prompts (in `subagent-definitions.ts`), and `.prompts/` agent templates must never contain repo-specific content. This includes: specific package manager commands (e.g. `pnpm run full-check`), specific tool names as if they are the only option (e.g. `turbo`, `vitest`), hardcoded instruction file names (e.g. `CLAUDE.md`), or project-specific directory paths (e.g. `apps/api/src/v1`). Repo-specific rules are injected dynamically at runtime via the `agentInstructions` field from `gh_clone`. Instructions should reference "the repository's instruction file" or "the `agentInstructions` field from `gh_clone`" — not specific filenames or commands. Examples in instructions should use generic placeholders (e.g. `npm install`, `npm test`, `<repo>/src/...`).

---

## Testing conventions

- **Always use package.json scripts**: Run tests via `pnpm test:unit`, `pnpm test:integration {filename}`, etc. **Never** invoke test runners directly (`vitest`, `npx vitest`, `pnpm vitest run`).
- **Never run full test suites**: `pnpm test` and bare `pnpm test:integration` (without a filename) are **forbidden**. Always target a specific scope.
- **Unit tests** (`*.spec.ts`): placed next to the source file. Run with `pnpm test:unit`. Prefer updating an existing spec file over creating a new one.
- **Integration tests** (`*.int.ts`): in `src/__tests__/integration/`. Call services directly (no HTTP). **Mandatory** when modifying code that already has integration tests — always run with a specific filename: `pnpm test:integration {filename}`. **NEVER** run bare `pnpm test:integration` without a filename.
- **E2E tests** (`*.cy.ts`): in `apps/api/cypress/e2e/`. Smoke-test endpoints over HTTP. Require a running server + deps.
- **E2E type safety**: When creating or modifying E2E tests, always regenerate API type definitions first (`cd apps/api && pnpm test:e2e:generate-api`). E2E helpers and tests **must** import request/response types from `../../api-definitions` (e.g. `import type { GraphDto, GetAllGraphsData } from '../../api-definitions'`) instead of defining inline types. Use the generated `*Data['query']` types for query parameters and the generated `*Dto` types for response bodies.
- **Must-fail policy**: Tests must never conditionally skip based on missing env vars or services. If a prerequisite is absent, the test must fail with a clear error — no `it.skip` or early returns.
- **Coverage thresholds** (when enabled): 90% lines/functions/statements, 80% branches.
- **E2E logging**: use `cy.task('log', message)` to print to terminal output.

---
