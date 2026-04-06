# Bugs Review Criteria

Logic errors, null/undefined checks, boundary conditions, state management, and type safety issues — TypeScript, NestJS, MikroORM, React 19, BullMQ.

## What to Check

### 1. Null/Undefined Handling

- Variables used without null checks before property access
- Optional chaining `?.` or nullish coalescing `??` missing where needed
- Conditional checks that don't cover all null/undefined cases
- Destructuring assignments without defaults for optional properties
- Array/object indexing without length/existence check
- MikroORM `findOne` returning `T | null` used without a guard
- `Map.get()` result used without `undefined` check

**How to detect:**
```bash
# Property access without null guard
grep -n "^\s*[a-zA-Z_][a-zA-Z0-9_]*\." file.ts | grep -v "if\|?\.\|&&\|??"
# Array indexing without guards
grep -n "\[[0-9]\+\]" file.ts | grep -v "length\|size"
# MikroORM findOne result used directly
grep -n "findOne\b" file.ts
# Map.get without undefined check
grep -n "\.get(" file.ts | grep -v "if\|?\.\|??\|!= null\|!== undefined"
```

**Common patterns:**
```typescript
// BAD — findOne returns T | null
const graph = await em.findOne(GraphEntity, { id });
return graph.name; // TypeError if null

// GOOD
const graph = await em.findOne(GraphEntity, { id });
if (!graph) {
  throw new NotFoundException(`Graph ${id} not found`);
}
return graph.name;

// BAD — array access without guard
const first = items[0].id;

// GOOD
if (items.length === 0) {
  throw new BadRequestException('No items provided');
}
const first = items[0].id;
```

### 2. Off-By-One Errors

- Loop conditions: `i < array.length` vs `i <= array.length`
- Pagination: limit/offset calculations producing wrong page counts
- MikroORM `offset`/`limit` passed as wrong values
- BullMQ job retry count boundary (e.g., `attempts - 1`)
- `Array.slice()` end index off by one

**How to detect:**
```bash
# Loop boundary patterns
grep -nE "for\s*\(\s*.*\s*(<=|>=)" file.ts
# Pagination arithmetic
grep -n "offset\|limit\|skip\|take" file.ts
# Slice boundaries
grep -n "\.slice(" file.ts
```

### 3. State Management Issues

**React state:**
- Stale closures capturing old state in `useEffect`/`useCallback`/`useMemo`
- Missing or incomplete dependency arrays causing stale reads or infinite re-renders
- State mutations instead of immutable updates (`state.items.push()` instead of `setItems([...items, newItem])`)
- `setState` calls inside async callbacks without checking if component is still mounted
- Missing cleanup of Socket.IO subscriptions, timers, or AbortControllers in `useEffect` return

**Backend state:**
- Async operations racing on shared mutable state in NestJS services
- BullMQ job processors modifying shared service-level state without synchronization

**How to detect:**
- Find `useEffect` bodies referencing state variables not listed in deps array
- Identify `socket.on(...)` calls without a corresponding `socket.off(...)` in the cleanup return
- Check `useCallback`/`useMemo` for missing or stale dependency arrays
- Look for `setTimeout`/`setInterval` without `clearTimeout`/`clearInterval` in cleanup

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

// BAD — stale closure over count
const increment = useCallback(() => {
  setCount(count + 1); // captures stale count
}, []); // count missing from deps

// GOOD
const increment = useCallback(() => {
  setCount((prev) => prev + 1);
}, []);
```

### 4. Type Safety Issues

- `any` used to bypass TypeScript checks
- `as unknown as T` double-cast to force incompatible types
- Missing type narrowing after `unknown` input
- Zod schema not matched by the DTO class (schema and `createZodDto` out of sync)
- Return type declared but not actually enforced (implicit `any` from external lib)
- `@ts-ignore` or `@ts-expect-error` hiding real type errors
- Generic type parameters defaulting to `any` silently

**How to detect:**
```bash
# any usage
grep -n ": any\|as any\|<any>" file.ts
# Double-cast escape hatch
grep -n "as unknown as" file.ts
# ts-ignore suppressing errors
grep -n "@ts-ignore\|@ts-expect-error" file.ts
# Missing return type on public methods
grep -nE "^\s*(async\s+)?[a-z]\w*\(.*\)\s*\{" file.ts | grep -v ":"
```

**Common patterns:**
```typescript
// BAD — any silences the compiler
function processInput(data: any): void {
  data.forEach((item: any) => save(item));
}

// GOOD — typed and validated
function processInput(data: unknown): void {
  const parsed = InputSchema.parse(data); // Zod validates at runtime
  parsed.forEach((item) => save(item));
}

// BAD — double cast hiding a real mismatch
const user = response as unknown as UserEntity;

// GOOD — validate shape
const user = plainToInstance(UserEntity, response);
```

### 5. Error Handling Gaps

- `try/catch` blocks with empty or swallowed catch bodies
- `async` service methods with no error context logged before re-throwing
- BullMQ job processors (`@Process`) without error handling — failed jobs silently drop
- Raw `Error` thrown instead of custom exceptions from `@packages/common`
- Promise rejections not handled in fire-and-forget async calls
- NestJS `@OnEvent` decorator handlers throwing without being caught — NestJS swallows the error silently
- Missing `@Injectable()` decorator on a provider class — causes cryptic DI resolution error at runtime
- Circular module dependency causing `Nest can't resolve dependencies` at startup
- Controller method returning a raw MikroORM entity with uninitialized lazy collections — causes serialization errors or incomplete JSON

**How to detect:**
```bash
# Empty catch
grep -A2 "} catch" file.ts | grep -E "^\s*\}"
# Fire-and-forget async (not awaited, no .catch)
grep -n "this\.\w\+(" file.ts | grep -v "await\|return\|\.then\|\.catch\|void "
# BullMQ processor without error handling
grep -B2 -A10 "@Process\b" file.ts | grep -v "try\|catch"
# @OnEvent without try/catch
grep -B1 -A15 "@OnEvent" file.ts | grep -v "try\|catch"
# Missing @Injectable on class with constructor injection
grep -B5 "constructor(" file.ts | grep -v "@Injectable"
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

// BAD — raw Error
throw new Error('Not found');

// GOOD — custom exception with context
throw new NotFoundException(`Graph ${id} not found`);

// BAD — async controller method missing await
@Get(':id')
async getGraph(@Param('id') id: string): Promise<GraphDto> {
  return this.graphsService.getById(id); // missing await — loses stack trace
}

// GOOD
@Get(':id')
async getGraph(@Param('id') id: string): Promise<GraphDto> {
  return await this.graphsService.getById(id);
}
```

### 6. Logic Errors

- Inverted conditionals or wrong boolean operators in guards
- NestJS guard returning `false` when it should throw (causes generic 403, not the intended exception)
- MikroORM `FilterQuery` conditions that are always truthy/falsy
- Unreachable code after `throw` in service methods
- Non-exhaustive `switch` over TypeScript enums — missing `default` or missing cases
- Strict vs loose equality: `==` instead of `===` allowing type coercion
- Logical AND `&&` vs OR `||` confusion in compound conditions
- MikroORM N+1 queries: accessing a lazy `Collection` or `Reference` field in a loop without prior `populate`
- Calling `.load()` or `.init()` inside a `map`/`forEach`
- Forgetting `{ populate: [...] }` in `find*` calls when relations are needed immediately

**How to detect:**
```bash
# Inverted guards
grep -n "if\s*(\s*!" file.ts | grep -A2 "return\|throw"
# Unreachable after throw
grep -n "throw new" file.ts | grep -A2 "return\b"
# Switch without default
grep -n "switch\s*(" file.ts | grep -v "default"
# Loose equality
grep -n "==[^=]" file.ts
# N+1: .init() or .load() inside iteration
grep -n "\.map(\|\.forEach(" file.ts | grep -A3 "\.init(\|\.load("
# Collection access without populate hint
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

// BAD — loose equality allows coercion
if (status == 'active') { ... }

// GOOD — strict equality
if (status === 'active') { ... }
```

### 7. Resource Leaks

- Socket.IO event listeners registered in `useEffect` without cleanup
- `setTimeout`/`setInterval` not cleared on component unmount
- MikroORM `EntityManager` forked manually but not cleared after use
- BullMQ queues/workers instantiated in request scope and never closed
- `AbortController` signal not aborted on component unmount for in-flight fetch calls
- Event listeners added via `addEventListener` without `removeEventListener` in cleanup
- Readable streams or file handles opened but never closed in error paths

**How to detect:**
```bash
# Event listeners without cleanup
grep -n "\.on(\|\.addEventListener(" file.ts
grep -n "\.off(\|\.removeListener\|\.removeEventListener(" file.ts
# Timers without clear
grep -n "setTimeout\|setInterval" file.ts | grep -v "clearTimeout\|clearInterval"
# EM fork without clear
grep -n "em\.fork\b" file.ts | grep -v "clear\b"
# AbortController without abort
grep -n "new AbortController" file.tsx | grep -v "\.abort("
```

### 8. Boundary Conditions

- Empty array/object handling in service methods
- Division by zero in metric or rate calculations
- BullMQ job `delay` or `attempts` set to 0 (effectively disables retries)
- Pagination `limit = 0` causing `Math.ceil(total / 0) = Infinity`
- String operations on potentially empty or whitespace-only strings
- Integer overflow in `setTimeout` delay (max ~2^31 ms)
- UUID validation missing on route params — invalid UUID causes MikroORM query error

**How to detect:**
```bash
# Division without zero check
grep -nE "\/ [a-zA-Z]" file.ts | grep -v "if\|> 0\|!== 0"
# Empty array not handled
grep -n "\.length\b" file.ts | grep -v "if\|>\|<\|==="
# BullMQ zero attempts
grep -n "attempts:" file.ts
```

**Common patterns:**
```typescript
// BAD — division by zero
const avgTime = totalTime / completedJobs; // completedJobs could be 0

// GOOD
const avgTime = completedJobs > 0 ? totalTime / completedJobs : 0;

// BAD — empty array not handled
const latest = items.sort((a, b) => b.date - a.date)[0].id; // throws if empty

// GOOD
if (items.length === 0) {
  return null;
}
const latest = items.sort((a, b) => b.date - a.date)[0].id;
```

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

7. **React 19 automatic batching** — Multiple `setState` calls in the same event handler are batched automatically
   - Do not flag sequential `setState` calls as race conditions

8. **Zod `.optional()` vs `.nullable()`** — Zod distinguishes between `undefined` (optional) and `null` (nullable)
   - `.optional()` allows `undefined`, `.nullable()` allows `null`, `.nullish()` allows both — check intent before flagging

## Review Checklist

- [ ] All `findOne` results checked for null before use
- [ ] Loop boundaries correct (`<` vs `<=`, length checks)
- [ ] React `useEffect` subscriptions cleaned up on unmount
- [ ] `useEffect`/`useCallback`/`useMemo` dependency arrays complete
- [ ] All errors explicitly caught and handled or re-thrown
- [ ] No `any` bypassing type checks
- [ ] No `@ts-ignore` or `@ts-expect-error` without explanation
- [ ] BullMQ job handlers have error handling and re-throw
- [ ] MikroORM relations populated before iteration (no N+1)
- [ ] Logic flows correct (no inverted conditions, exhaustive switch, strict equality)
- [ ] Custom exceptions from `@packages/common` used, not raw `Error`
- [ ] Edge cases handled (empty collections, zero denominators, pagination boundaries)
- [ ] NestJS controller async methods use `return await` (not bare `return promise`)
- [ ] All provider classes have `@Injectable()` decorator
- [ ] No circular module dependencies in NestJS DI graph

## Severity Guidelines

- **CRITICAL**: Null dereference in critical path, infinite loop, wrong auth logic, BullMQ job silently dropping failures, missing `@Injectable()` crashing app at startup, circular DI preventing boot
- **HIGH**: Race condition in React state, MikroORM N+1 in a hot path, unhandled async error, stale closure causing incorrect UI state, `as any` hiding a real type mismatch in business logic
- **MEDIUM**: Potential edge-case null, missing cleanup leak, off-by-one in pagination, non-exhaustive switch, loose equality (`==`), missing dependency array entry with low-impact staleness
