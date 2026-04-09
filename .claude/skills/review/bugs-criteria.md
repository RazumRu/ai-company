# Bugs Review Criteria

Logic errors, null/undefined checks, boundary conditions, state management, and type safety issues.

## What to Check

### 1. Null/Undefined Handling
- Variables used without null checks before property access
- Optional chaining `?.` or null coalescing `??` missing
- Conditional checks that don't cover all null cases
- Destructuring assignments without defaults
- Array/object indexing without length/existence check

**How to detect:**
```bash
# Find property access patterns without guards
grep -n "^\s*[a-zA-Z_][a-zA-Z0-9_]*\." file.ts | grep -v "if\|?.\|&&\|??"
# Find array indexing without guards
grep -n "\[[0-9]\+\]" file.ts | grep -v "length\|size"
```

**Common patterns:**
- `obj.field` without `obj` null check
- `array[0]` without `array.length > 0`
- MikroORM `em.findOne()` result used without null check

### 2. Off-By-One Errors
- Loop conditions: `i < array.length` vs `i <= array.length`
- Range checks: inclusive vs exclusive boundaries
- Pagination: limit/offset calculations
- Timeout/delay calculations

### 3. State Management Issues
- Async state updates without synchronization
- Race conditions in concurrent operations (especially BullMQ jobs)
- React stale closures capturing old state in `useEffect`/`useCallback`
- Missing cleanup in `useEffect` (WebSocket subscriptions, event listeners)
- MikroORM EntityManager used across async boundaries without forking

### 4. Type Safety Issues
- Type mismatches in comparisons (loose `==` for type-dependent logic)
- Implicit type coercions causing bugs
- Missing Zod validation on API boundaries
- `as` type assertions hiding real type mismatches
- Return type mismatches

**How to detect:**
```bash
# Loose equality in comparisons
grep -nE "==\s|!=\s" file.ts | grep -v "==="
# Unsafe type assertions
grep -n "as any\|as unknown" file.ts
```

### 5. Error Handling Gaps
- Try-catch blocks without finally/cleanup
- Errors silently caught and ignored
- Promise rejections not handled
- Missing error propagation in NestJS service chains

### 6. Logic Errors
- Inverted conditionals (`if (!condition)` when should be `if (condition)`)
- Wrong operator used (`&&` instead of `||`)
- Unreachable code after return/break/throw
- Duplicate/contradictory conditions

### 7. Resource Leaks
- WebSocket subscriptions not cleaned up in React components
- BullMQ workers not properly shut down
- MikroORM EntityManager connections not released
- Event listeners registered but not removed
- Timers not cleared (`setTimeout`/`setInterval`)
- Docker containers not cleaned up (Runtime module)

**How to detect:**
```bash
# Event listeners without cleanup
grep -n "\.on(\|\.addEventListener(" file.ts
grep -n "\.off(\|\.removeListener\|\.removeEventListener(" file.ts
# Timers without clear
grep -n "setTimeout\|setInterval" file.ts | grep -v "clearTimeout\|clearInterval"
# WebSocket subscriptions
grep -n "subscribe\|\.on(" file.ts | grep -v "unsubscribe\|cleanup\|return"
```

### 8. Boundary Conditions
- Empty array/object handling
- Single-element edge cases
- Maximum/minimum value limits
- Division by zero

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

1. **Defensive coding** — Extra null checks aren't always wrong
2. **Async complexity** — Async operations appear unsynchronized but may be intentional (Promise.all)
3. **Flexible equality** — `if (value == null)` is common for both null/undefined
4. **Intentional mutations** — Some objects are designed to be mutable
5. **Configuration-driven** — Behavior controlled by external config
6. **MikroORM identity map** — Entities loaded in same EM context are identity-mapped; null checks may be unnecessary for pre-loaded relations

## Project-Specific Checks

- **MikroORM N+1:** Lazy-loaded relations accessed inside loops without `populate` — causes N+1 queries
- **Zod schema drift:** DTO Zod schema doesn't match entity fields — runtime validation passes but DB insert fails
- **BullMQ job retry:** Jobs that mutate state without idempotency — retries cause duplicate side effects
- **Socket.IO event leaks:** Emitting events without checking if client is still connected

## Review Checklist

- [ ] All variables used have null/undefined checks
- [ ] Loop boundaries are correct (< vs <=, length checks)
- [ ] Async state updates are synchronized
- [ ] Type comparisons are correct (=== for strict)
- [ ] All errors are caught and handled
- [ ] Logic flows are correct (no inverted conditions)
- [ ] Resources are cleaned up (listeners, subscriptions, timers)
- [ ] Edge cases handled (empty, single item, max values)

## Severity Guidelines

- **CRITICAL**: Null pointer exception, infinite loop, logic inversion causing wrong behavior
- **HIGH**: Race condition, off-by-one in critical path, unhandled error, EntityManager leak
- **MEDIUM**: Potential panic in edge case, missing edge case handling, type confusion
