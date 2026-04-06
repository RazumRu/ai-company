# Architecture Review Criteria

Design patterns, modularity, coupling, performance, scalability, and technical debt for NestJS + React monorepo.

## What to Check

### 1. Module Design & Coupling
- Circular dependencies between NestJS modules
- High coupling: too many imports from other feature modules
- Low cohesion: module doing multiple unrelated things
- Missing abstraction layers (controller calling DAO directly)

**How to detect:**
```bash
# Count imports per file
grep -c "^import" file.ts
# Find circular imports
grep -rn "import.*from" apps/api/src/v1/ | grep -v node_modules
# Check dependency directions — services should not import controllers
grep -n "import.*Controller" file.service.ts
```

**Red flags:**
- Single file with 20+ imports
- Service importing from another module's DAO directly (should go through that module's service)
- Controller containing business logic (should delegate to service)
- DAO containing business logic (should be in service)

### 2. Layered Architecture Violations
- Controller → Service → DAO → Entity layering must be respected
- Controllers must be thin (route + validate only)
- Services own business logic and orchestrate DAOs
- DAOs inject EntityManager, use FilterQuery<T>

**How to detect:**
```bash
# Controllers doing too much
grep -n "EntityManager\|em\.\|findOne\|getAll" file.controller.ts
# DAOs with business logic
grep -n "if.*throw\|validate\|check" file.dao.ts
# Services importing other services' DAOs directly
grep -n "import.*Dao" file.service.ts | grep -v "$(dirname file.service.ts)"
```

### 3. NestJS Module Design
- Each feature module should be self-contained in `apps/api/src/v1/<feature>/`
- Module exports should be minimal (only what other modules need)
- Cross-module communication via EventEmitter2, not direct imports

**How to detect:**
- Check `*.module.ts` for proper imports/exports/providers
- Look for services importing from other modules without proper module dependency

### 4. Code Organization & Structure
- Feature-based directory structure: `controllers/`, `services/`, `dao/`, `dto/`, `entity/`
- `*.types.ts` for types/interfaces only (no functions)
- `*.utils.ts` for utility functions
- Class files contain only the class

**How to detect:**
```bash
# Files that are hard to categorize
find apps/api/src -name "*.ts" | grep "util\|misc\|temp\|helper"
# Large files
wc -l file.ts | awk '$1 > 500 {print $0}'
```

### 5. Error Handling Architecture
- Use custom exceptions from `@packages/common` (NotFoundException, BadRequestException)
- Never swallow errors silently
- Consistent error propagation through layers

### 6. Performance & Scalability
- N+1 query patterns (queries inside loops instead of batched)
- Missing MikroORM population/eager loading
- Unnecessary data loading
- Missing caching (Redis) for repeated expensive operations

**How to detect:**
```bash
# N+1 patterns — queries inside loops
grep -n "for\|while\|\.map(\|\.forEach(" file.ts | grep -A5 "findOne\|getOne\|getAll\|find("
# Missing population
grep -n "findOne\|find(" file.ts | grep -v "populate\|fields"
```

**Red flags:**
- `getOne()` or `findOne()` inside a loop — should batch with `$in` or populate
- Large collections loaded without pagination (`getAll` without limit)
- Synchronous operations in async request path

### 7. Technical Debt
- TODO/FIXME comments
- Deprecated patterns
- Inconsistent with project conventions

**How to detect:**
```bash
grep -n "TODO\|FIXME\|XXX\|HACK" file.ts
```

### 8. Testing Architecture
- Code designed to be difficult to test
- Pure business logic mixed with I/O
- Global state or singletons
- Hard dependencies on implementations

## Project-Specific Architecture Checks

- **Layered architecture**: Controller → Service → DAO → Entity must be respected
- **DTOs in single file**: All DTOs for a module in one `dto/*.dto.ts` file
- **Migrations auto-generated**: Never hand-written migration files
- **Package aliases**: Use `@packages/*` imports for shared packages
- **EventEmitter2 for cross-module**: Cross-module communication via events, not direct service injection where possible

## Output Format

```json
{
  "type": "architecture",
  "severity": "critical|high|medium",
  "title": "Brief architecture issue",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description",
  "category": "coupling|abstraction|solid|organization|errorhandling|performance|debt|testing",
  "impact": "Why this matters",
  "recommendation": "Proposed fix",
  "confidence": 85
}
```

## Common False Positives

1. **Pragmatic design** — Framework integration often requires tight coupling
2. **Intentional repetition** — Duplicating for different contexts is sometimes correct
3. **NestJS patterns** — NestJS modules have framework-specific patterns
4. **Configuration-driven** — DI handles coupling at runtime

## Review Checklist

- [ ] Module dependencies are acyclic
- [ ] Layered architecture respected (Controller → Service → DAO)
- [ ] Each module has clear, single purpose
- [ ] Code organization follows feature-based structure
- [ ] Error handling uses custom exceptions from @packages/common
- [ ] No N+1 query patterns
- [ ] Technical debt documented
- [ ] Code is designed to be testable

## Severity Guidelines

- **CRITICAL**: Circular dependencies, layered architecture violations, N+1 in hot path
- **HIGH**: High coupling, missing abstractions, controller with business logic
- **MEDIUM**: Inconsistent patterns, minor organizational improvements
