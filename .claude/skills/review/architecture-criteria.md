# Architecture Review Criteria

Design patterns, modularity, coupling, performance, scalability, and technical debt assessment.

## What to Check

### 1. Module Design & Coupling
- Circular dependencies between NestJS modules
- High coupling: too many imports from other feature modules
- Low cohesion: module doing multiple unrelated things
- Missing abstraction layers (Controller → Service → DAO violated)
- Tight coupling to external services/libraries

**How to detect:**
```bash
# Count imports per file
grep -c "^import" file.ts
# Find cross-module imports (feature importing from another feature)
grep -n "from.*v1/" file.ts | grep -v "from.*v1/$(dirname file.ts | xargs basename)"
# Check dependency directions — DAO should not import Controller
grep "import.*controller\|import.*Controller" file.dao.ts
```

**Red flags:**
- Single file with 20+ imports
- Service importing directly from another feature's DAO
- Controller containing business logic (should be in Service)
- DAO importing from Service layer (wrong direction)
- Direct external API calls scattered throughout (should go through dedicated service)

### 2. Abstraction & Interface Design
- Missing abstraction layers (business logic in controllers)
- Poor interface design (leaky abstractions)
- Violation of NestJS Dependency Injection pattern
- Hard dependencies on concrete implementations
- Controllers doing more than route + validate

**How to detect:**
- Look for direct `EntityManager` usage in controllers
- Find service classes importing from other features' DAOs directly
- Check for hardcoded configuration values in services
- Identify services with unclear purpose (doing too much)

**Red flags:**
- Controller with `em.findOne()` calls (bypass service/DAO)
- Service importing another feature's entity directly
- Utils importing from domain layers
- Services that are hard to name (too many responsibilities)

### 3. Layered Architecture Compliance
- **Controller → Service → DAO → Entity** layer violations
- Controllers containing business logic
- Services bypassing DAOs for direct EntityManager access
- DAOs containing business logic
- Cross-feature DAO access without going through the feature's service

**How to detect:**
```bash
# Controllers with business logic
grep -n "em\.\|EntityManager\|findOne\|findAll" file.controller.ts
# Services bypassing DAO
grep -n "em\.\|EntityManager" file.service.ts | grep -v "constructor"
# Cross-feature DAO imports
grep -n "import.*Dao" file.service.ts | grep -v "$(basename $(dirname file.service.ts))"
```

**Red flags:**
- `em.findOne()` in a controller (should be in DAO via service)
- Service directly querying database without DAO
- Controller creating/manipulating entities
- Cross-feature DAO access (should go through that feature's service)

### 4. Code Organization & Structure
- Inconsistent file structure across feature modules
- Related functionality scattered across modules
- Poor naming conventions (unclear file/function purposes)
- Missing separation of concerns
- Inconsistent patterns/styles between `src/v1/` feature modules

**How to detect:**
```bash
# Check feature module structure consistency
for dir in apps/api/src/v1/*/; do
  echo "=== $dir ==="
  ls "$dir" | sort
done
# Find large files (potential split opportunity)
wc -l file.ts | awk '$1 > 500 {print $0}'
```

**Red flags:**
- Feature module missing expected files (dto/, entities/, *.module.ts)
- Same feature scattered across multiple directories
- Very large files (500+ lines)
- Functions with vague names (do, process, handle)

### 5. Error Handling Architecture
- Inconsistent error handling patterns
- Missing error context propagation
- Not using custom exceptions from `@packages/common`
- Swallowing errors without logging
- No error hierarchy/classification

**How to detect:**
- Look for inconsistent try-catch patterns
- Find places where errors are silently caught
- Check if `NotFoundException`, `BadRequestException` from `@packages/common` are used
- Identify generic `Error` thrown instead of custom exceptions

**Red flags:**
- `catch (e) {}` (empty catch)
- `throw new Error()` instead of `throw new NotFoundException()`
- Errors logged without context
- Different error handling per feature module

### 6. Performance & Scalability
- N+1 query patterns (queries inside loops instead of batched/joined)
- Inefficient algorithms (O(n^2) where O(n) possible)
- Missing MikroORM eager loading / `populate` option
- Synchronous operations blocking event loop
- Missing caching or memoization (Redis cache layer available)
- Unbounded queries without pagination

**How to detect:**
```bash
# Potential N+1 — queries inside loops
grep -n "for\|while\|\.map(\|\.forEach(" file.ts | grep -A5 "findOne\|getOne\|em\."
# Missing populate/eager loading
grep -n "findOne\|find(" file.ts | grep -v "populate\|fields"
# Blocking operations
grep -n "Sync(" file.ts
# Unbounded queries
grep -n "findAll\|getAll\|find(" file.ts | grep -v "limit\|offset\|take"
```

**Red flags:**
- `em.findOne()` inside a loop (classic N+1)
- MikroORM lazy-loading in iteration (accessing relations in a loop)
- Large data structures not paginated
- Synchronous I/O in request handlers
- Missing Redis caching for repeated expensive operations

### 7. Technical Debt
- Deprecated patterns or libraries still in use
- TODO/FIXME comments indicating unresolved issues
- Inconsistent with team/project standards
- Ad-hoc solutions when proper patterns exist
- Code that works but is hard to understand/maintain

**How to detect:**
```bash
# Find TODO/FIXME comments
grep -n "TODO\|FIXME\|XXX\|HACK" file.ts
# Deprecated API usage
grep -n "deprecated\|obsolete" file.ts
# Comments indicating problems
grep -n "workaround\|temporary\|quick fix" file.ts
```

### 8. Testing Architecture
- Code designed to be difficult to test
- Heavy use of mocks indicates poor design
- Missing integration test coverage for critical paths
- Difficult to set up test context due to tight coupling

**How to detect:**
- Check if services are testable via constructor injection
- Look for services with many side effects
- Identify areas requiring complex `Test.createTestingModule()` setup
- Check for hardcoded values/dependencies

**Red flags:**
- Business logic mixed with I/O (untestable)
- Global state or singletons used outside NestJS DI
- Functions doing both computation and side effects
- External API calls embedded in core logic

## Project-Specific Checks

- **Layer violations**: Controller → Service → DAO → Entity must be respected — services should never bypass DAOs, controllers should never contain business logic (from project architecture)
- **Feature module isolation**: Each `src/v1/<feature>/` should be self-contained with its own dto/, entities/, controller, service, dao, module files
- **Socket.IO event architecture**: Real-time events should go through the notifications module — not emitted directly from services
- **BullMQ job design**: Background jobs should be idempotent and handle failures gracefully
- **MikroORM identity map**: Be aware of EntityManager scope — forking EM for background operations

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
  "category": "coupling|abstraction|solid|organization|errorhandling|performance|debt|testing",
  "pattern_location": ["file.ts:42", "other.ts:15"],
  "current_design": "How it's currently structured",
  "impact": "Why this matters (maintainability, scalability, etc.)",
  "recommendation": "Proposed refactoring or improvement",
  "confidence": 85
}
```

## Common False Positives

1. **Pragmatic design** — Sometimes coupling is acceptable for simplicity
   - NestJS module integration often requires some cross-module awareness
   - Small features don't need full layered architecture
   - Check project size and constraints

2. **Intentional repetition** — Code reuse isn't always beneficial
   - Duplicating code for different contexts is sometimes correct
   - Premature abstraction creates worse problems
   - Only flag obvious shared logic

3. **Framework patterns** — NestJS has specific patterns by design
   - Module providers/exports create intentional coupling
   - Decorators mix concerns by design
   - Check if pattern is NestJS-recommended

4. **Configuration-driven behavior** — Behavior controlled externally
   - NestJS DI handles most configuration injection
   - Check if values come from proper config sources

5. **Intentional simplification** — Simple code beats perfect design
   - Don't flag over-engineering fears
   - Some coupling is acceptable for simplicity
   - Only flag if causing real problems

## Review Checklist

- [ ] Module dependencies are acyclic
- [ ] Each module has clear, single purpose
- [ ] Controller → Service → DAO layering respected
- [ ] Feature modules are self-contained
- [ ] Error handling uses custom exceptions from `@packages/common`
- [ ] No obvious performance red flags (N+1, unbounded queries)
- [ ] Technical debt is documented/addressed
- [ ] Code is designed to be testable
- [ ] Patterns align with codebase standards

## Severity Guidelines

- **CRITICAL**: Circular dependencies, layer violations in critical paths, architectural patterns preventing scalability
- **HIGH**: High coupling, missing abstractions, N+1 patterns, cross-feature DAO access
- **MEDIUM**: Inconsistent patterns, minor organizational improvements, refactoring opportunities
