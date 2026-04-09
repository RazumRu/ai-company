# Architecture Review Criteria

Design patterns, modularity, coupling, performance, scalability, and technical debt for NestJS + MikroORM monorepo.

## What to Check

### 1. Module Design & Coupling
- Circular dependencies between NestJS modules
- High coupling: too many imports from other feature modules
- Services directly importing from other modules' DAOs (should go through service layer)

**How to detect:**
```bash
# Count imports per file
grep -c "^import" file.ts
# Find cross-module imports
grep -n "from.*v1/" file.ts
```

### 2. Layered Architecture Violations
- Controller doing business logic instead of delegating to service
- Service doing raw database queries instead of using DAO
- DAO containing business logic beyond queries
- Entity containing service-level logic

### 3. NestJS Module Structure
- Missing module registration for new providers
- Exported services not properly listed in module `exports`
- Missing `forwardRef` for legitimate circular dependencies

### 4. Code Organization & Structure
- Files placed in wrong directory for their type
- Very large files (500+ lines) that should be split

**How to detect:**
```bash
find apps/api/src/v1/ -name "*.ts" -exec wc -l {} + | sort -rn | head -20
```

### 5. Error Handling Architecture
- Inconsistent error handling patterns across modules
- Custom exceptions not used (raw `Error` instead of `@packages/common` exceptions)

### 6. Performance & Scalability
- N+1 query patterns (MikroORM lazy-loading inside loops without `populate`)
- Missing pagination on list endpoints
- Missing caching for repeated expensive operations

**How to detect:**
```bash
# N+1 patterns
grep -n "\.map(\|\.forEach(\|for " file.ts | grep -A3 "\.\(find\|get\|load\|fetch\)"
# Missing pagination
grep -n "findAll\|find(" file.ts | grep -v "limit\|offset\|take\|skip\|paginate"
```

### 7. Technical Debt
- TODO/FIXME comments without context
- Deprecated patterns or libraries

### 8. Testing Architecture
- Code designed to be difficult to test
- Pure business logic mixed with I/O operations

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
  "category": "coupling|layering|module|organization|errorhandling|performance|debt|testing",
  "impact": "Why this matters",
  "recommendation": "Proposed improvement",
  "confidence": 85
}
```

## Common False Positives

1. **Pragmatic design** — Small modules don't need full layer separation
2. **NestJS patterns** — Framework requires certain coupling (decorators, DI)
3. **Cross-module events** — Socket.IO event emission across modules is by design

## Project-Specific Checks

- **Layered architecture:** Every feature must follow `Controller → Service → DAO → Entity`
- **DAO pattern:** Use `FilterQuery<T>` for type-safe filtering. Avoid proliferating `findByX` methods.
- **DTOs:** All use Zod schemas with `createZodDto()`. Keep all DTOs for a module in a single file.
- **Shared packages:** Import via `@packages/*` aliases.

## Review Checklist

- [ ] Module dependencies are acyclic
- [ ] Layered architecture followed (Controller → Service → DAO → Entity)
- [ ] NestJS module properly registers all providers
- [ ] Error handling uses `@packages/common` exceptions
- [ ] No obvious N+1 query patterns
- [ ] List endpoints are paginated

## Severity Guidelines

- **CRITICAL**: Circular dependencies, layered architecture violations in critical paths
- **HIGH**: N+1 queries, missing abstractions, cross-module coupling, missing pagination
- **MEDIUM**: Inconsistent patterns, minor organizational improvements
