# Architecture Review Criteria

Design patterns, modularity, coupling, performance, scalability, and technical debt — NestJS + Fastify, MikroORM, React 19, pnpm monorepo, BullMQ, Socket.IO.

## What to Check

### 1. Module Design and Coupling (NestJS)

- Circular NestJS module dependencies (Module A imports Module B's provider, B imports A's)
- High coupling: a module importing providers from 5+ other feature modules directly
- Low cohesion: a single NestJS module handling multiple unrelated features
- Feature modules importing from `apps/api/src/v1/` sibling modules directly instead of using exported interfaces
- `@packages/*` shared packages imported correctly via alias — never via relative `../../packages/`
- Packages (`@packages/common`, `@packages/http-server`, `@packages/mikroorm`, `@packages/metrics`) importing from `apps/` — strictly forbidden

**How to detect:**
```bash
# Count module imports in a module file
grep -c "from '\.\." apps/api/src/v1/feature/feature.module.ts
# Direct sibling module imports in service files
grep -rn "from '\.\./" apps/api/src/v1/graphs/graphs.service.ts | grep "v1/"
# Verify @packages alias usage
grep -rn "from '\.\./\.\./\.\./packages" apps/api/src/ | grep -v "test\|spec"
# Package boundary violation — packages importing from apps
grep -rn "from '.*apps/" packages/
# Check for circular: A imports B and B imports A
grep -rn "GraphsModule\|AgentsModule" apps/api/src/v1/agents/agents.module.ts
grep -rn "AgentsModule" apps/api/src/v1/graphs/graphs.module.ts
```

**Circular dependency verification:** Trace the full dependency chain, not just direct imports. A->B->C->A is circular even though no single module directly imports its own importer. NestJS will throw `Nest can't resolve dependencies` at startup.

**Red flags:**
- `GraphsModule` imports `AgentsModule` and `AgentsModule` imports `GraphsModule` — use `forwardRef()` only as a last resort; restructure instead
- Feature module with 15+ imports in its `@Module` decorator
- A single module handling both user auth and graph compilation
- `import { SomeService } from '../../agents/agents.service'` (cross-module service import without going through module exports)
- `import { GraphsService } from 'apps/api/src/v1/graphs/graphs.service'` inside `packages/common`

### 2. Layered Architecture (Controller -> Service -> DAO -> Entity)

- Business logic in controllers (controllers must be thin: route + validate + delegate)
- Database queries in service methods (services must use DAOs, not inject `EntityManager` directly)
- Controllers injecting DAOs directly instead of services
- Services bypassing DAOs and using raw `EntityManager` for queries that belong in a DAO
- Entities used as response types (entities should be mapped to DTOs before returning from controllers)
- Services importing controllers — inverted dependency direction
- DTOs using `class-validator` decorators instead of Zod schemas with `createZodDto()`

**How to detect:**
```bash
# EM injected into controller
grep -rn "EntityManager\|@InjectEntityManager" apps/api/src/v1/**/*.controller.ts
# DAO injected into controller (should go through service)
grep -rn "Dao\b" apps/api/src/v1/**/*.controller.ts | grep "constructor"
# Business logic in controller (conditional/loop in handler body)
grep -rn "if\s*(\|for\s*(\|while\s*(" apps/api/src/v1/**/*.controller.ts | grep -v "guard\|pipe"
# Entity returned directly from controller
grep -rn "return.*Entity\b\|: .*Entity>" apps/api/src/v1/**/*.controller.ts
# Service importing a controller (inverted dependency)
grep -rn "\.controller'" apps/api/src/v1/**/*.service.ts
# class-validator usage (should be Zod)
grep -rn "class-validator\|@IsString\|@IsNumber\|@IsOptional\|@IsNotEmpty\|@IsEnum\|@IsUUID\|@IsArray\|@IsBoolean\|@ValidateNested" apps/api/src/v1/**/*.dto.ts
# Verify Zod DTO pattern
grep -rn "createZodDto" apps/api/src/v1/**/*.dto.ts
```

**Red flags:**
- `constructor(private readonly em: EntityManager)` in a controller
- `this.graphDao.getOne(...)` called inside a controller handler body
- Complex conditional logic or loops in a controller method (should be in service)
- `return graphEntity` from a controller method (should map to `GraphDto`)
- `import { GraphsController } from './graphs.controller'` inside `graphs.service.ts`
- `@IsString()` or `@IsNotEmpty()` from `class-validator` in a DTO — must use `z.string()` with `createZodDto()`

### 3. DAO Design (MikroORM)

- Proliferating `findByX` methods when `FilterQuery<T>` covers the use case
- Raw `em.execute()` for queries achievable with typed `FilterQuery`
- DAO methods that contain business logic (DAOs are query-only)
- Missing `populate` hints leading to lazy-loaded N+1 queries from service callers
- `EntityManager` used directly in services instead of routing through DAO
- Entity relationships defined without proper MikroORM decorators (`@ManyToOne`, `@OneToMany`, `@ManyToMany`)

**How to detect:**
```bash
# findBy method proliferation
grep -rn "async findBy\|async getBy" apps/api/src/v1/**/*.dao.ts
# Business logic in DAO (conditionals beyond query construction)
grep -rn "if\s*(\|throw new" apps/api/src/v1/**/*.dao.ts
# EM injected into service directly
grep -rn "EntityManager" apps/api/src/v1/**/*.service.ts | grep "constructor"
# Raw SQL when ORM methods suffice
grep -rn "em\.execute\|\.raw(" apps/api/src/v1/**/*.dao.ts
```

**Red flags:**
- `findByUserId`, `findByStatus`, `findByStatusAndUserId` as separate DAO methods — use `getAll({ userId, status })` with `FilterQuery` instead
- DAO method throwing `NotFoundException` — that is service responsibility
- Service injecting `EntityManager` alongside a DAO for the same entity
- `em.execute('SELECT * FROM graphs WHERE ...')` when `em.find(GraphEntity, { ... })` covers the query

### 4. Frontend Architecture (React 19 + Refine + Radix UI)

- Auto-generated API client (`src/autogenerated/`) manually edited or bypassed with custom `fetch`/`axios` wrappers
- Custom inline UI components replicating primitives already in `src/components/ui/`
- Business logic embedded in React components instead of extracted to custom hooks or services
- State management scattered across components when it should live in a custom hook or service
- `WebSocketService` or `GraphStorageService` instantiated inside components instead of injected via context/hooks
- Direct `localStorage`/`sessionStorage` access in components instead of going through `GraphStorageService`
- Prop drilling through 3+ component levels instead of using context or composition
- Giant components (300+ lines) that should be decomposed
- Not using Refine's `useList`, `useOne`, `useCreate`, `useUpdate`, `useDelete` for CRUD operations

**How to detect:**
```bash
# Manual API calls bypassing generated client
grep -rn "axios\.\|fetch(" apps/web/src/ | grep -v "autogenerated\|test\|spec\|node_modules"
# Direct localStorage in components
grep -rn "localStorage\.\|sessionStorage\." apps/web/src/pages/
# Direct WebSocketService instantiation
grep -rn "new WebSocketService\|new GraphStorageService" apps/web/src/pages/
# Prop drilling — same prop passed through many layers
grep -rn "interface.*Props" apps/web/src/pages/**/*.tsx | head -20
# Components over 300 lines
wc -l apps/web/src/pages/**/*.tsx | sort -rn | head -20
# Custom fetch/axios wrappers outside autogenerated
grep -rn "import.*from.*axios\|import.*from.*node-fetch" apps/web/src/ | grep -v "autogenerated\|node_modules"
```

**Red flags:**
- `fetch('/api/graphs')` inside a React component — must use auto-generated client via Refine data provider
- `<div className="...">` with custom styling when `<Badge>`, `<Card>`, `<Button>` from `src/components/ui/` exists
- 300-line component with complex `useState`/`useEffect` chains that should be extracted to a custom hook
- `localStorage.setItem('viewport', ...)` directly in `GraphCanvas.tsx` instead of `GraphStorageService`
- `const [data, setData] = useState(); useEffect(() => { fetch(...) }, [])` instead of Refine's `useOne`/`useList`

### 5. pnpm Monorepo Boundaries

- `apps/web` importing from `apps/api` (cross-app imports are forbidden)
- `apps/api` importing from `apps/web`
- `packages/*` importing from `apps/*` — packages must never depend on applications
- Shared code placed in `apps/` instead of extracted to a `packages/` library
- `packages/common` or `packages/mikroorm` imported via relative path instead of `@packages/common`
- New shared utility added to a feature module instead of the appropriate `packages/` package
- Turborepo task dependencies not configured for new packages

**How to detect:**
```bash
# Cross-app imports
grep -rn "from '.*apps/api" apps/web/src/
grep -rn "from '.*apps/web" apps/api/src/
# Package -> app import (forbidden)
grep -rn "from '.*apps/" packages/
# Relative path to packages
grep -rn "from '\.\./\.\./\.\./packages\|from '\.\./packages" apps/
# Shared-looking code in feature modules
grep -rn "export.*class\|export.*function" apps/api/src/v1/*/utils.ts | grep -v "test"
```

**Red flags:**
- `import { SomeEntity } from '../../api/src/v1/graphs/entities/graph.entity'` in web app
- `import { DefaultLogger } from '../../../packages/common/src/logger'` — should be `@packages/common`
- `import { GraphsService } from '../../apps/api/src/v1/graphs/graphs.service'` inside a package
- `AuthContextService` duplicated in two feature modules instead of being in a shared module

### 6. Performance and Scalability

- MikroORM N+1 queries: lazy collection or reference accessed inside a loop without prior `populate`
- Unbounded queries: `getAll({})` with no `limit`/`take` on endpoints that could return thousands of rows
- BullMQ jobs enqueued in a tight loop without batching or rate limiting
- Synchronous heavy operations blocking the Fastify event loop (e.g., `readFileSync` in a request handler)
- Missing Redis caching for repeated expensive Qdrant/LiteLLM calls
- Socket.IO broadcasting to all clients when only a subset needs the event — use `NotificationEvent` enum scoped to rooms
- Missing `populate()` on MikroORM queries that access related entities in subsequent code

**How to detect:**
```bash
# Unbounded queries
grep -rn "getAll\|\.find(\|findAll" apps/api/src/v1/**/*.ts | grep -v "limit\|take\|pagination\|test\|spec"
# Sync blocking in async context
grep -rn "readFileSync\|writeFileSync\|execSync" apps/api/src/v1/
# Qdrant/LiteLLM without cache
grep -rn "qdrant\.\|litellm\." apps/api/src/v1/ | grep -v "cache\|Cache"
# Broad socket emit
grep -rn "server\.emit\b\|io\.emit\b" apps/api/src/v1/ | grep -v "room\|to("
# Missing populate in queries followed by relation access
grep -rn "\.nodes\.\|\.edges\.\|\.threads\.\|\.messages\." apps/api/src/v1/**/*.service.ts | grep -v "populate"
```

**N+1 distinction:**
- **BAD (N+1):** `for (const graph of graphs) { await graph.nodes.init(); }` — N queries
- **GOOD (populate):** `await this.graphDao.getAll({}, { populate: ['nodes'] })` — 1 query
- **GOOD (join):** MikroORM `qb.leftJoinAndSelect(...)` — 1 query

**Red flags:**
- Collection `.init()` or `.load()` inside a `for`/`forEach`/`.map()` loop
- `this.graphDao.getAll({})` with no pagination in a controller that returns a list
- `server.emit('graph:update', data)` without scoping to a room/namespace — use `NotificationEvent` enum with room targeting
- No `@packages/cache` usage on a service method called on every request
- `await em.find(GraphEntity, {})` without `{ populate: ['nodes', 'edges'] }` when related data is accessed later

### 7. Error Handling and Notifications

- Inconsistent error handling: some layers use `try/catch`, others let exceptions propagate without context
- Errors thrown as raw `new Error('...')` instead of typed custom exceptions from `@packages/common`
- NestJS exception filter not handling a new custom exception type — falls through to 500
- `catch (e) {}` — silent swallow anywhere in the codebase
- BullMQ failed jobs not landing in DLQ because error is swallowed before re-throw
- WebSocket notifications not using `NotificationEvent` enum for event type consistency
- Notification events pushed without proper room scoping

**How to detect:**
```bash
# Raw Error throws
grep -rn "throw new Error(" apps/api/src/v1/ | grep -v "test\|spec"
# Silent catch
grep -A1 "} catch" apps/api/src/ | grep -E "^\s*\}"
# Custom exceptions imported correctly
grep -rn "NotFoundException\|BadRequestException\|ForbiddenException" apps/api/src/v1/ | grep "import"
# Notification events not using enum
grep -rn "\.emit(" apps/api/src/v1/**/*.ts | grep -v "NotificationEvent\|test\|spec"
# String literal event names instead of NotificationEvent enum
grep -rn "emit('" apps/api/src/v1/ | grep -v "NotificationEvent"
```

**Red flags:**
- `throw new Error('Graph not found')` — use `throw new NotFoundException('Graph not found')`
- `catch (error) { console.log(error); }` — no re-throw, no structured log, silent failure
- New custom exception class not registered in the global exception filter
- `this.socketServer.emit('graph:compiled', data)` — should use `NotificationEvent.GRAPH_COMPILED` enum value
- WebSocket event pushed to all connected clients when it should target a specific user's room

### 8. Technical Debt and Testing Architecture

- TODO/FIXME comments without an issue reference left in production code
- Deprecated NestJS, MikroORM, or BullMQ APIs still in use
- Hand-written migration files (must always be generated via `pnpm run migration:generate`)
- Manually edited files in `src/autogenerated/` (must be regenerated with `pnpm generate:api`)
- Ad-hoc solutions replacing patterns that already exist elsewhere in the codebase
- Business logic embedded in controllers or entities, making unit testing impossible without HTTP
- Global state or module-level singletons that cannot be reset between tests
- MikroORM `EntityManager` accessed as a global singleton rather than per-request fork
- External API calls (LiteLLM, GitHub, Qdrant) directly embedded in service methods without an injectable interface — hard to mock
- DTOs defined with `class-validator` instead of Zod schemas — inconsistent with project convention

**How to detect:**
```bash
# TODO/FIXME without issue reference
grep -rn "TODO\|FIXME\|XXX\|HACK" apps/api/src/v1/ | grep -v "#[0-9]\|https://"
# Hand-written migrations (check for non-generated patterns)
grep -rn "QueryRunner\|createTable\|addColumn" apps/api/src/db/migrations/ | head -5
# Manual edits in autogenerated files
git log --oneline -- apps/web/src/autogenerated/
# Global state
grep -rn "^let \|^const .*= \[\]\|^const .*= {}" apps/api/src/v1/ | grep -v "test\|spec\|module\b"
# External API calls in service (not going through an injectable client)
grep -rn "fetch(\|axios\." apps/api/src/v1/**/*.service.ts
# Entity with business logic
grep -rn "^\s*async \|^\s*public \w\+(" apps/api/src/v1/*/entities/
# class-validator imports (should be Zod)
grep -rn "from 'class-validator'" apps/api/src/
```

**Red flags:**
- Migration file with hand-crafted SQL instead of generated `execute('ALTER TABLE ...')`
- `apps/web/src/autogenerated/` modified in a commit not generated by `pnpm generate:api`
- Duplicate utility function implementing the same logic as an existing one in `@packages/common`
- `// TODO: fix this later` without a linked issue
- `fetch('https://api.openai.com/...')` directly in a service method instead of going through the injected LiteLLM client
- Module-level `const cache = new Map()` shared across requests
- Entity class methods containing business logic that should be in the service layer
- `import { IsString, IsNotEmpty } from 'class-validator'` — must use Zod schemas

## Output Format

```json
{
  "type": "architecture",
  "severity": "critical|high|medium",
  "title": "Brief architecture issue",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description of architectural concern",
  "category": "coupling|layering|dao_design|frontend|monorepo|performance|errorhandling|debt|testability",
  "pattern_location": ["file.ts:42", "other.ts:15"],
  "current_design": "How it is currently structured",
  "impact": "Why this matters (maintainability, scalability, correctness)",
  "recommendation": "Proposed refactoring or improvement",
  "confidence": 85
}
```

## Common False Positives

1. **Pragmatic layering** — Thin delegation methods in services are not violations
   - A service method that only calls a DAO and returns is fine — not every method needs business logic
   - Controllers that add `@ApiBearerAuth()` or logging are still thin

2. **Intentional module coupling** — Some modules are designed to work together
   - `threads` and `agents` modules intentionally share concerns; check if the coupling is bidirectional
   - NestJS `forwardRef()` is acceptable for well-understood mutual dependencies

3. **Framework patterns** — NestJS requires some coupling by design
   - Importing a DTO from a sibling module for request/response typing is acceptable
   - NestJS DI wiring in `*.module.ts` files inherently couples modules — this is expected

4. **Configuration-driven behavior** — Some services are intentionally flexible
   - Injectable clients for LiteLLM or Qdrant with configurable endpoints are correct
   - Don't flag abstract config injection as tight coupling

5. **Intentional simplification** — Not all code needs full SOLID adherence
   - Small utilities or thin wrappers don't need an interface + implementation pair
   - Only flag if the lack of abstraction is causing real problems (untestable, unextendable)

6. **Monorepo size** — Some cross-package patterns are intentional
   - `apps/api` sharing types with `apps/web` via a `packages/` library is the correct pattern — don't flag the library itself

## Review Checklist

- [ ] NestJS module dependencies are acyclic (no `forwardRef` without documented justification)
- [ ] Controllers are thin: route, validate, delegate only — no business logic
- [ ] Services use DAOs for queries; do not inject `EntityManager` directly
- [ ] DAOs use `FilterQuery<T>` — no proliferating `findByX` methods
- [ ] DTOs use Zod schemas with `createZodDto()` — no `class-validator` decorators
- [ ] No cross-app imports between `apps/web` and `apps/api`
- [ ] `@packages/*` imports use alias, not relative paths
- [ ] `packages/*` never import from `apps/*`
- [ ] Auto-generated files (`src/autogenerated/`) not manually edited
- [ ] No unbounded list queries — all list endpoints paginated
- [ ] No MikroORM N+1 patterns (lazy collection init inside loops; missing `populate()`)
- [ ] No raw SQL when MikroORM `FilterQuery` or query builder suffices
- [ ] Custom exceptions from `@packages/common` used throughout — no raw `new Error()`
- [ ] WebSocket notifications use `NotificationEvent` enum with room scoping
- [ ] No TODO/FIXME without linked issue
- [ ] Business logic is not embedded in entities or controllers
- [ ] React components under 300 lines; complex state extracted to hooks
- [ ] Frontend uses auto-generated API client and Refine hooks for CRUD

## Severity Guidelines

- **CRITICAL**: Circular NestJS module dependency causing startup failure, business logic in entities making them non-portable, cross-app imports breaking monorepo boundaries, `packages/*` importing from `apps/*`
- **HIGH**: Business logic in controllers, DAOs injected into controllers, N+1 in hot query path, unbounded list query, manually edited autogenerated files, `class-validator` DTOs instead of Zod, service importing controller (inverted dependency)
- **MEDIUM**: DAO method proliferation (findByX), missing DAO populate hint, raw SQL when ORM suffices, TODO without issue, WebSocket events using string literals instead of `NotificationEvent` enum, React component over 300 lines, minor organizational inconsistency
