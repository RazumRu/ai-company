# Guidelines Review Criteria

Code style, naming conventions, documentation, consistency, and compliance with project standards — TypeScript strict, NestJS on Fastify, MikroORM, React 19, Radix UI, Tailwind CSS, pnpm + Turbo monorepo.

## What to Check

### 1. Naming Conventions

- PascalCase required for classes, interfaces, enums, and types
- camelCase required for variables, functions, and method names
- PascalCase required for enum members
- UPPER_SNAKE_CASE required for module-level constants
- React components must use PascalCase (`GraphCanvas`, not `graphCanvas`)
- React hooks must use `use` prefix (`useWebSocket`, `useGraphData`)
- React prop interfaces must use `*Props` suffix (`GraphCanvasProps`, `NodeEditSidebarProps`)
- Vague or misleading names (`data`, `x`, `temp`, `result`, `obj`) in non-trivial scope
- Magic numbers and strings without named constants

**How to detect:**
```bash
# Single-letter or vague variable names outside loops
grep -nE "^\s*(const|let)\s+(x|y|z|data|temp|result|obj|arr|str)\b" file.ts

# Class/interface not PascalCase
grep -n "^(export\s+)?(class|interface|enum|type)\s+[a-z]" file.ts

# UPPER_SNAKE_CASE constants
grep -n "^export const [A-Z_]\+\s*=" file.ts | grep -v "^export const [A-Z][A-Z_0-9]*\s*="

# Magic numbers
grep -nE "[^a-zA-Z_][0-9]{2,}[^0-9a-zA-Z_]" file.ts | grep -v "200\|404\|422\|500\|timestamp\|version\|0x"

# React component not PascalCase (default export of lowercase function)
grep -nE "export default function [a-z]" file.tsx

# React hook not using use prefix
grep -nE "^export (const|function) [a-z][a-zA-Z]+\s*=?\s*\(" file.tsx | grep -v "^export (const|function) use[A-Z]"

# Prop interfaces without Props suffix
grep -nE "^(export\s+)?(interface|type)\s+\w+(?<!Props)\s*\{" file.tsx | grep -i "prop"
```

**Red flags:**
- `const d = await this.dao.getOne(...)` — `d` is not descriptive
- `class graphsService` — class name should be `GraphsService`
- `enum status { active, inactive }` — should be `enum Status { Active = 'active', Inactive = 'inactive' }`
- `const TIMEOUT = 30000` without a name explaining what the timeout is for
- `export default function graphCanvas()` — React component must be `GraphCanvas`
- `export function fetchGraphData()` used as a hook — should be `useGraphData()`
- `interface GraphOptions` for component props — should be `GraphCanvasProps`

### 2. Function and Method Naming

- Methods should begin with a clear verb: `get`, `create`, `update`, `delete`, `find`, `validate`, `compile`, `emit`, `build`
- Generic names without context (`process`, `handle`, `do`, `execute` alone) are not acceptable
- NestJS controller handler names should reflect the HTTP action and resource
- Boolean-returning functions should use `is`, `has`, `can`, `should` prefix
- Private helper methods should still be descriptive (not `_process`, `_handle`)

**How to detect:**
```bash
# Generic method names
grep -nE "async (do|process|handle|execute|run|work)\s*\(" file.ts | grep -v "handleJob\|handleEvent\|processQueue"

# Boolean function without is/has/can prefix
grep -n "): boolean\|=> boolean" file.ts | grep -v "is[A-Z]\|has[A-Z]\|can[A-Z]\|should[A-Z]"
```

**Red flags:**
- `async process(data: unknown): Promise<void>` — what does "process" mean?
- `private handle()` — handle what?
- `checkUser()` returning boolean should be `isUserActive()` or `hasPermission()`
- NestJS controller method `run()` — should be `executeGraph()` or `compileGraph()`

### 3. TypeScript Strict Conventions

- `any` is forbidden — use specific types, generics, or `unknown` + type guards
- All public service/controller methods must have explicit return types
- `as` type assertions are a code smell — prefer type guards, generics, or proper typing; flag `as` casts that bypass type safety
- `as unknown as T` double-cast is a red flag — usually indicates a type design problem
- Loose equality (`==`, `!=`) is forbidden — always use strict equality (`===`, `!==`)
- Nullable columns use `T | null` (not `T | undefined`) to match DB/JSON semantics
- Optional properties use `?` only for truly optional fields, not as a shorthand for nullable
- `z.infer<typeof Schema>` must be used to derive types from Zod schemas — never duplicate the shape manually

**How to detect:**
```bash
# any usage
grep -nE ": any\b|as any\b|<any>" file.ts

# Missing return type on public methods
grep -nE "^\s*(async\s+)?[a-z][a-zA-Z]+\s*\([^)]*\)\s*\{" file.ts | grep -v ":\s*Promise\|:\s*[A-Z]\|:\s*void\|:\s*string\|:\s*number\|:\s*boolean"

# as type assertions (excluding test files)
grep -nE "\bas\s+[A-Z]\w+" file.ts | grep -v "test\|spec\|\.int\."

# Double cast
grep -n "as unknown as" file.ts

# Loose equality
grep -nE "[^=!]==[^=]|[^!]!=[^=]" file.ts

# Manual interface duplicating a Zod schema
grep -n "^interface\|^type " file.ts | grep -A5 "string\|number\|boolean"
```

**Red flags:**
- `function getGraph(id: any)` — parameter typed as `any`
- Public service method with no return type annotation
- `(result as GraphDto)` — use a type guard or fix the upstream type
- `(result as unknown as GraphDto)` — indicates structural mismatch that should be fixed at the type level
- `if (status == 'active')` — must use `===`
- `interface CreateGraphRequest { name: string; description?: string }` defined when a Zod schema already exists — use `z.infer<typeof CreateGraphSchema>`

### 4. File Organization Rules

- `*.types.ts` files: only types, interfaces, enums, constants — no functions
- `*.utils.ts` files: only utility/helper functions — no classes
- Class files (services, controllers, DAOs): only the class — no standalone functions
- All imports at the top of the file — no inline `require()` calls
- DTOs for a module must be in a single `feature.dto.ts` file using Zod + `createZodDto()`

**How to detect:**
```bash
# Functions in types files
grep -n "^export function\|^function\b\|^export const.*=>\s*{" file.types.ts

# Standalone functions in class files
grep -n "^export function\|^function\b" file.service.ts

# Inline require
grep -n "require(" file.ts | grep -v "^import"

# Multiple DTO files for same module
ls apps/api/src/v1/graphs/ | grep "dto"
```

**Red flags:**
- `export function formatDate(...)` inside `graph.types.ts` — move to `graph.utils.ts`
- `function buildFilterQuery(...)` at the bottom of `graph.service.ts` — standalone functions must not live in class files
- `create-graph.dto.ts`, `update-graph.dto.ts`, `graph-response.dto.ts` — all DTOs for a module belong in one `graph.dto.ts` file
- `const { readFileSync } = require('fs')` inline inside a function body

### 5. Error Handling Style

- Always throw custom exceptions from `@packages/common` (`NotFoundException`, `BadRequestException`, `ForbiddenException`)
- Never throw raw `new Error(...)` in service or controller code
- Never swallow errors silently — always re-throw or log with context
- Always `return await` async calls — never bare `return somePromise()` (loses stack trace context)
- `catch (error)` blocks must either re-throw or log with full context via `DefaultLogger`

**How to detect:**
```bash
# Raw Error throws
grep -n "throw new Error(" file.ts | grep -v "test\|spec"

# Bare return of promise
grep -n "return this\.\|return service\.\|return dao\." file.ts | grep -v "await\b"

# Silent catch
grep -A2 "} catch" file.ts | grep -E "^\s*\}"

# console instead of logger
grep -n "console\.log\|console\.error\|console\.warn" file.ts | grep -v "test\|spec"
```

**Red flags:**
- `throw new Error('Not found')` — use `throw new NotFoundException('Not found')`
- `return this.graphDao.getOne(id)` in an async method — must be `return await this.graphDao.getOne(id)`
- `catch (e) { }` — empty catch silently swallows errors
- `console.error(error)` — use `this.logger.error(message, { error })` from `DefaultLogger`

### 6. Imports and Dependencies

- All imports at the top of the file, in this order: Node built-ins, third-party packages, `@packages/*` aliases, relative imports
- No wildcard imports (`import * as X from 'module'`) except in generated files
- No unused imports (TypeScript strict mode + ESLint catches this)
- Relative imports going up more than 2 levels (`../../..`) should use `@packages/*` alias instead
- Never import from `src/autogenerated/` in backend code — autogenerated client is frontend-only
- Frontend components must import from `src/components/ui/` shared library, not create inline equivalents

**How to detect:**
```bash
# Wildcard imports
grep -n "import \* as" file.ts | grep -v "test\|spec\|autogenerated"

# Deep relative imports
grep -n "from '\.\./\.\./\.\." file.ts | grep -v "@packages"

# Autogenerated imported in backend
grep -rn "from '.*autogenerated" apps/api/src/

# Import order issues
head -20 file.ts | grep "^import"
```

**Red flags:**
- `import * as _ from 'lodash'` — import specific functions
- `import { DefaultLogger } from '../../../packages/common/src'` — use `@packages/common`
- `import { GraphDto } from '../../autogenerated/api'` in a backend service file

### 7. Comments, Documentation, and Code Duplication

**Comments and documentation:**
- No comments that restate what the code does — only comments that explain *why*
- Public service methods and controller endpoints should have JSDoc if the intent is non-obvious
- `TODO` and `FIXME` must include a linked issue number
- NestJS `@ApiProperty()` decorators required on DTO fields for Swagger documentation
- Agent tool `getDetailedInstructions()` must be comprehensive — not a one-liner

**Code duplication:**
- Copy-pasted logic blocks (5+ lines) that should be a shared utility in `*.utils.ts` or `@packages/common`
- Repeated Zod schema fragments that should be extracted as a shared schema constant
- Duplicate MikroORM `FilterQuery` construction patterns copy-pasted across DAOs
- Test helper setup duplicated across spec files instead of extracted to a shared test factory

**How to detect:**
```bash
# Obvious comments
grep -n "//" file.ts | grep -iE "increment|set variable|call function|get the|return the"

# TODO without issue
grep -n "TODO\|FIXME\|XXX\|HACK" file.ts | grep -v "#[0-9]\|https://"

# @ApiProperty missing on DTO
grep -n "^\s*[a-z].*:\s*string\|^\s*[a-z].*:\s*number" file.dto.ts | grep -v "@ApiProperty\|readonly\|static\|private"

# Repeated Zod patterns across files
grep -rn "z\.string()\.min(1)\.max(200)" apps/api/src/v1/ | wc -l

# Copy-pasted DAO filter patterns
grep -rn "{ createdBy:.*userId" apps/api/src/v1/ | head -5
```

**Red flags:**
- `// get the graph` above `const graph = await this.graphDao.getOne(id)` — obvious comment
- `// TODO: fix this` with no issue number
- DTO class field without `@ApiProperty()` decorator — Swagger will not document it
- Agent tool `getDetailedInstructions()` returning a single sentence
- Same Zod schema shape defined in three different DTO files — extract as `BaseEntitySchema`
- `buildPaginationQuery(offset, limit)` implemented three times across DAOs — move to `@packages/mikroorm`
- Test file calling `createTestUser()` inline in each test — extract to a shared test factory

### 8. Consistency with Codebase (Convention Guard)

This is the most critical guideline dimension — AI-generated code's primary failure mode is introducing patterns that differ from existing conventions ("convention drift").

- New code uses a pattern that exists nowhere else in the codebase
- Error handling approach differs from existing services in the same module
- Import style (named vs default, path depth) differs from convention
- File placed in wrong directory for its type
- New dependency added when an existing dependency covers the use case
- React component uses inline styles or CSS modules when the codebase uses Tailwind CSS utility classes
- React component creates custom primitives instead of using Radix UI components from `src/components/ui/`
- NestJS module structure deviates from the `controller -> service -> dao -> entity` layered pattern

**How to detect — Exemplar File Comparison:**

The key technique: find the closest existing file and diff the patterns.

```bash
# Step 1: Find exemplar files
ls apps/api/src/v1/graphs/           # See existing module structure
ls apps/web/src/pages/graphs/        # See existing page structure

# Step 2: Compare naming, imports, export style
grep -n "^export\|^import\|^class\|^const\|^interface\|^type" new_file.ts > /tmp/new.txt
grep -n "^export\|^import\|^class\|^const\|^interface\|^type" exemplar.ts > /tmp/old.txt
diff /tmp/new.txt /tmp/old.txt

# Step 3: Compare error handling pattern
grep -n "try\|catch\|throw\|NotFoundException\|BadRequestException" new_file.ts
grep -n "try\|catch\|throw\|NotFoundException\|BadRequestException" exemplar.ts

# Step 4: Compare DTO structure
head -40 new_file.dto.ts
head -40 apps/api/src/v1/graphs/graphs.dto.ts

# Step 5: Compare React component patterns
grep -n "className\|tailwind\|cn(\|from.*radix" new_component.tsx
grep -n "className\|tailwind\|cn(\|from.*radix" apps/web/src/components/ui/button.tsx
```

**Convention drift signals:**
- New code uses `default export` when every other module uses named exports
- New service uses `try/catch` wrapper pattern when existing services let NestJS handle exceptions
- New DTO file contains multiple files pattern when the project uses single-file DTOs
- New utility added to `v1/graphs/` when it should be in `@packages/common` based on reuse pattern
- New React component uses inline `style={{}}` or CSS modules when the codebase uses Tailwind CSS classes
- New React component creates a custom `<Dialog>` when `@radix-ui/react-dialog` via `src/components/ui/` exists
- Test file uses `jest` APIs when the project uses `vitest`

**Red flags:**
- New service method with `try/catch` wrapping a DAO call — existing services do not do this
- New component using `fetch()` when all others use the auto-generated API client
- New DTO file with `class-validator` decorators when codebase uses `nestjs-zod`
- `import React from 'react'` in new React 19 file — not needed, and no other file does it
- File created at `apps/api/src/v1/graphs/helpers/graph-helper.ts` when convention is `graph.utils.ts` in module root
- New component using `styled-components` or `emotion` when the codebase uses Tailwind CSS
- New page component defining its own `<Button>` instead of importing from `src/components/ui/button`

## Output Format

```json
{
  "type": "guidelines",
  "severity": "critical|high|medium",
  "title": "Style or guideline violation",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Description of the guideline violation",
  "category": "naming|types|file_organization|error_handling|imports|comments|duplication|consistency",
  "current": "Current code/pattern",
  "expected": "Expected code/pattern per guidelines",
  "recommendation": "How to fix it",
  "confidence": 92
}
```

## Common False Positives

1. **Single-letter vars in tight scope** — Acceptable in short lambdas and loop indices
   - `array.map(x => x.id)` is acceptable
   - `for (let i = 0; i < n; i++)` is standard
   - Flag only if the variable is used across 5+ lines without being self-evident

2. **Generic names in test fixtures** — Often acceptable for test setup
   - `const graph = createTestGraph()` in a spec file is fine
   - Flag only if confusing within the test body

3. **Pragmatic duplication** — Two similar implementations may have legitimately different requirements
   - Duplicate Zod schemas with intentionally different constraints are not always worth abstracting
   - Only flag when obvious shared logic has no differentiating factors

4. **`any` at framework boundaries** — Some narrow cases are unavoidable
   - `JSON.parse()` returns `any` by design — use a type guard or Zod parse after
   - Bridge code to untyped third-party libraries may use `any` with a comment explaining why
   - Check if there is a legitimate reason before flagging

5. **Comments explaining why** — These are good, not obvious
   - Business domain context, performance rationale, or workaround explanations are valuable
   - Only flag comments that restate what the code syntactically does

6. **Linter config overrides** — The project may have specific ESLint/Prettier rules
   - Check `.eslintrc.*` and `prettier.config.*` before flagging style issues
   - A `// eslint-disable-next-line` with explanation is acceptable

7. **`as` assertions in tests** — Test files frequently use `as` casts for mock setup
   - `const mockDao = { getOne: vi.fn() } as unknown as GraphDao` is standard vitest pattern
   - Only flag `as` casts in production code that bypass type safety

8. **Tailwind class strings** — Long `className` strings are normal with Tailwind CSS
   - `className="flex items-center gap-2 rounded-md bg-white px-4 py-2"` is idiomatic
   - Do not flag long class strings as style violations

## Review Checklist

- [ ] PascalCase for classes, interfaces, enums, types
- [ ] camelCase for variables and functions
- [ ] PascalCase for React components; `use*` prefix for hooks; `*Props` suffix for prop interfaces
- [ ] UPPER_SNAKE_CASE for module-level constants
- [ ] No `any` — specific types, generics, or `unknown` + type guards used
- [ ] No `as` type assertions that bypass type safety in production code
- [ ] No loose equality (`==`, `!=`) — strict equality (`===`, `!==`) only
- [ ] All public service/controller methods have explicit return types
- [ ] `return await` used for all async calls (not bare `return promise`)
- [ ] Custom exceptions from `@packages/common` thrown, not raw `Error`
- [ ] All DTOs for a module in a single `feature.dto.ts` using Zod + `createZodDto()`
- [ ] No standalone functions in class files; no functions in `*.types.ts` files
- [ ] Utility functions in `*.utils.ts` files, not in types or class files
- [ ] All imports at file top; no inline `require()`
- [ ] No wildcard imports; no deep relative paths (use `@packages/*` alias)
- [ ] `DefaultLogger` used, not `console`
- [ ] TODO/FIXME include linked issue number
- [ ] `@ApiProperty()` on all DTO fields
- [ ] React components use Radix UI primitives from `src/components/ui/`, not custom inline equivalents
- [ ] Tailwind CSS utility classes used for styling, not inline styles or CSS modules
- [ ] No convention drift — new code matches patterns of exemplar files in same module

## Severity Guidelines

- **CRITICAL**: Breaks TypeScript strict mode guarantees (`any` bypassing security/correctness), inline `require()` causing circular dependency or module resolution issues, loose equality causing type coercion bugs
- **HIGH**: Missing return types on public API, raw `Error` throws, bare `return promise()` losing stack context, unsafe `as` type assertions in production code, convention drift introducing a new pattern not used elsewhere
- **MEDIUM**: Naming style inconsistency, magic number, missing `@ApiProperty`, obvious comment, TODO without issue, minor import order issue, missing `Props` suffix on prop interface, component not using shared UI library
