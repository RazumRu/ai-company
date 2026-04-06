# Bugs Review Criteria

Logic errors, null/undefined checks, boundary conditions, state management, and type safety issues — TypeScript, NestJS, MikroORM, React 19, BullMQ.

## What to Check

### 1. Null/Undefined Handling

- Variables used without null checks before property access
- Optional chaining `?.` or null coalescing `??` missing
- Conditional checks that don't cover all null cases
- Destructuring assignments without defaults
- Array/object indexing without length/existence check
- MikroORM `findOne` returning `null` used without a guard

**How to detect:**
```bash
# Property access without null guard
grep -n "^\s*[a-zA-Z_][a-zA-Z0-9_]*\." file.ts | grep -v "if\|?\.\|&&\|??"
# Array indexing without guards
grep -n "\[[0-9]\+\]" file.ts | grep -v "length\|size"
# MikroORM findOne result used directly
grep -n "findOne\b" file.ts
```

**Common patterns:**
- `entity.field` after `em.findOne()` without null check — `findOne` returns `T | null`
- `array[0].id` without `array.length > 0`
- Destructuring `const { user } = ctx` where `ctx.user` may be undefined in dev-bypass mode

### 2. Off-By-One Errors

- Loop conditions: `i < array.length` vs `i <= array.length`
- Pagination: limit/offset calculations
- MikroORM `offset`/`limit` passed as wrong values
- BullMQ job retry count boundary (e.g., `attempts - 1`)

**How to detect:**
```bash
# Loop boundary patterns
grep -nE "for\s*\(\s*.*\s*(<=|>=)" file.ts
# Pagination arithmetic
grep -n "offset\|limit\|skip\|take" file.ts
```

### 3. State Management Issues (React)

- Async state updates without synchronization
- Stale closures capturing old state in `useEffect`/`useCallback`
- Missing dependency arrays causing stale or infinite loops
- State mutations instead of immutable updates
- Missing cleanup of Socket.IO subscriptions, BullMQ listeners, or timers
- `useEffect` subscribing to WebSocket events without returning a cleanup function

**How to detect:**
- Look for `setState`/`setX` calls inside async callbacks without checking if component is still mounted
- Find `useEffect` bodies referencing state variables not listed in deps array
- Identify `socket.on(...)` calls without a corresponding `socket.off(...)` in the cleanup return
- Check `useCallback`/`useMemo` for missing or stale dependency arrays

**Common patterns:**
```typescript
// BAD — stale closure, socket never cleaned up
useEffect(() => {
  socket.on('graph:update', (data) => setGraph(data));
}, []); // missing cleanup

// GOOD
useEffect(() => {
  const handler = (data: GraphDto) => setGraph(data);
  socket.on('graph:update', handler);
  return () => { socket.off('graph:update', handler); };
}, [socket]);
```

### 4. Type Safety Issues

- `any` used to bypass TypeScript checks
- `as unknown as T` double-cast to force incompatible types
- Missing type narrowing after `unknown` input
- Zod schema not matched by the DTO class (schema and `createZodDto` out of sync)
- Return type declared but not actually enforced (implicit `any` from external lib)

**How to detect:**
```bash
# any usage
grep -n ": any\|as any\|<any>" file.ts
# Double-cast escape hatch
grep -n "as unknown as" file.ts
# Missing return type on public methods
grep -n "^\s*async [a-z].*{$" file.ts | grep -v ":"
```

### 5. Error Handling Gaps

- `try/catch` blocks with empty or swallowed catch bodies
- `async` service methods with no error context logged before re-throwing
- BullMQ job processors (`@Process`) without error handling — failed jobs silently drop
- Raw `Error` thrown instead of custom exceptions from `@packages/common`
- Promise rejections not handled in fire-and-forget async calls

**How to detect:**
```bash
# Empty catch
grep -A2 "} catch" file.ts | grep -E "^\s*\}"
# Fire-and-forget async (not awaited, no .catch)
grep -n "this\.\w\+(" file.ts | grep -v "await\|return\|\.then\|\.catch\|void "
# BullMQ processor without error handling
grep -B2 -A10 "@Process\b" file.ts | grep -v "try\|catch"
```

**Common patterns:**
```typescript
// BAD — BullMQ job silently fails
@Process()
async handleJob(job: Job<MyPayload>): Promise<void> {
  await this.service.process(job.data); // throws, no log
}

// GOOD
@Process()
async handleJob(job: Job<MyPayload>): Promise<void> {
  try {
    await this.service.process(job.data);
  } catch (error) {
    this.logger.error('Job failed', { jobId: job.id, error });
    throw error; // re-throw so BullMQ marks it failed
  }
}
```

### 6. Logic Errors

- Inverted conditionals or wrong boolean operators in guards
- NestJS guard returning `false` when it should throw (causes generic 403, not the intended exception)
- MikroORM `FilterQuery` conditions that are always truthy/falsy
- Unreachable code after `throw` in service methods
- Non-exhaustive `switch` over TypeScript enums — missing `default` or missing cases

**How to detect:**
```bash
# Inverted guards
grep -n "if\s*(\s*!" file.ts | grep -A2 "return\|throw"
# Unreachable after throw
grep -n "throw new" file.ts | grep -A2 "return\b"
# Switch without default
grep -n "switch\s*(" file.ts | grep -v "default"
```

### 7. Resource Leaks

- Socket.IO event listeners registered in `useEffect` without cleanup
- `setTimeout`/`setInterval` not cleared on component unmount
- MikroORM `EntityManager` forked manually but not cleared after use
- BullMQ queues/workers instantiated in request scope and never closed
- `AbortController` signal not aborted on component unmount for in-flight fetch calls

**How to detect:**
```bash
# Event listeners without cleanup
grep -n "\.on(\|\.addEventListener(" file.ts
grep -n "\.off(\|\.removeListener\|\.removeEventListener(" file.ts
# Timers without clear
grep -n "setTimeout\|setInterval" file.ts | grep -v "clearTimeout\|clearInterval"
# EM fork without clear
grep -n "em\.fork\b" file.ts | grep -v "clear\b"
```

### 8. NestJS-Specific Bugs

- Circular module dependency causing `Nest can't resolve dependencies` at startup
- Provider injected into a module it is not declared/exported in
- Controller method returning a raw MikroORM entity with uninitialized lazy collections — causes serialization errors or incomplete JSON
- `@OnEvent` decorator handlers throwing without being caught — NestJS swallows the error silently

**How to detect:**
```bash
# Potential circular imports within a module
grep -rn "from '\.\." file.ts | grep -v "dto\|entity\|types\|module"
# Lazy relation accessed on returned entity without populate
grep -n "return.*entity\|return.*graph\|return.*agent" file.ts
# @OnEvent without try/catch inside handler body
grep -B1 -A15 "@OnEvent" file.ts | grep -v "try\|catch"
```

### 9. MikroORM N+1 and Lazy Loading

- Accessing a lazy `Collection` or `Reference` field in a loop without prior `populate`
- Calling `.load()` or `.init()` inside a `map`/`forEach`
- Forgetting `{ populate: [...] }` in `find*` calls when relations are needed immediately

**How to detect:**
```bash
# .init() or .load() inside iteration
grep -n "\.map(\|\.forEach(" file.ts | grep -A3 "\.init(\|\.load("
# Collection access without populate hint in query
grep -n "getAll\|findAll\|find(" file.ts | grep -v "populate"
```

**Common patterns:**
```typescript
// BAD — N+1: one query per graph
const graphs = await this.graphDao.getAll({});
for (const graph of graphs) {
  await graph.nodes.init(); // N extra queries
}

// GOOD — single query with populate
const graphs = await this.graphDao.getAll({}, { populate: ['nodes'] });
```

### 10. Boundary Conditions

- Empty array/object handling in service methods
- Division by zero in metric or rate calculations
- BullMQ job `delay` or `attempts` set to 0 (effectively disables retries)
- Pagination `limit = 0` causing `Math.ceil(total / 0) = Infinity`

**How to detect:**
- Check arithmetic on user-supplied numbers: is the denominator validated as `> 0`?
- Check BullMQ `JobOptions` for zero values on `attempts` or `backoff`

## Output Format

```json
{
  "type": "bug",
  "severity": "critical|high|medium",
  "title": "Brief issue title",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description of the bug",
  "code_snippet": "Relevant code lines",
  "evidence": "Why this is a bug (execution path, condition)",
  "impact": "What could go wrong",
  "recommendation": "How to fix it",
  "confidence": 95
}
```

## Common False Positives

1. **Defensive coding** — Extra null checks are not always wrong
   - `if (obj && obj.field)` may be intentional for safety
   - Check if the pattern is consistent elsewhere in the codebase

2. **Async complexity** — Async operations may appear unsynchronized but be intentional
   - Check for explicit `await` and `Promise.all` patterns
   - BullMQ fire-and-forget is sometimes intentional for background tasks

3. **MikroORM `findOneOrFail`** — Throws automatically; no manual null check needed
   - Only flag `findOne` (nullable return) used without a guard

4. **Intentional stale closure** — Some `useEffect` deps are intentionally omitted
   - Look for `// eslint-disable-next-line react-hooks/exhaustive-deps` with an explanation comment

5. **NestJS global exception filters** — A registered `AllExceptionsFilter` may handle errors from `@OnEvent`
   - Check if a global filter exists before flagging missing try/catch

6. **MikroORM identity map** — EM caches entities; apparent extra queries may resolve from cache
   - Verify with query logging before flagging as N+1

## Review Checklist

- [ ] All `findOne` results checked for null before use
- [ ] Loop boundaries correct (`<` vs `<=`, length checks)
- [ ] React `useEffect` subscriptions cleaned up on unmount
- [ ] `useEffect`/`useCallback` dependency arrays complete
- [ ] All errors explicitly caught and handled or re-thrown
- [ ] No `any` bypassing type checks
- [ ] BullMQ job handlers have error handling and re-throw
- [ ] MikroORM relations populated before iteration (no N+1)
- [ ] Logic flows correct (no inverted conditions, exhaustive switch)
- [ ] Custom exceptions from `@packages/common` used, not raw `Error`
- [ ] Edge cases handled (empty collections, zero denominators, pagination boundaries)

## Severity Guidelines

- **CRITICAL**: Null dereference in critical path, infinite loop, wrong auth logic, BullMQ job silently dropping failures
- **HIGH**: Race condition in React state, MikroORM N+1 in a hot path, unhandled async error, NestJS circular dependency
- **MEDIUM**: Potential edge-case null, missing cleanup leak, off-by-one in pagination, non-exhaustive switch
