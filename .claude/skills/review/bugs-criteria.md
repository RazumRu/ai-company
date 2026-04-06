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
- `config.setting` where config could be undefined

### 2. Off-By-One Errors
- Loop conditions: `i < array.length` vs `i <= array.length`
- Range checks: inclusive vs exclusive boundaries
- Pagination: limit/offset calculations
- Timeout/delay calculations

**How to detect:**
```bash
grep -nE "for\s*\(\s*.*\s*(<=|>=|<|>|==)" file.ts
grep -n "indexOf\|slice\|substring" file.ts
```

### 3. State Management Issues
- React: stale closures capturing old state in `useEffect`/`useCallback`
- Missing cleanup in `useEffect` return (Socket.IO subscriptions, timers)
- Race conditions in concurrent async operations
- State mutations without immutability
- Missing state cleanup/disposal

**How to detect:**
- Look for `useEffect` without cleanup return for subscriptions
- Find `useState` setters called after component unmount
- Identify Socket.IO subscriptions without unsubscribe
- Check for shared mutable objects

### 4. Type Safety Issues
- Type mismatches in comparisons (loose `==` for type-dependent logic)
- Implicit type coercions causing bugs
- Unsafe type assertions (`as any`, `as unknown as T`)
- Return type mismatches

**How to detect:**
```bash
grep -nE "==\s|!=\s" file.ts | grep -v "==="
grep -n "as any\|as unknown" file.ts
```

### 5. Error Handling Gaps
- Try-catch blocks without finally/cleanup
- Errors silently caught and ignored
- Promise rejections not handled
- Missing error propagation in NestJS services

### 6. Logic Errors
- Inverted conditionals (`if (!condition)` when should be `if (condition)`)
- Wrong operator used (`&&` instead of `||`)
- Unreachable code after return/break/throw
- Duplicate/contradictory conditions

### 7. Resource Leaks
- Event listeners registered but not removed (Socket.IO, EventEmitter2)
- Timers not cleared (setTimeout, setInterval)
- Database connections not released (EntityManager forks)
- BullMQ job processors not cleaned up
- React useEffect subscriptions without cleanup

**How to detect:**
```bash
grep -n "\.on(\|\.addEventListener(" file.ts
grep -n "\.off(\|\.removeListener\|\.removeEventListener(" file.ts
grep -n "setTimeout\|setInterval" file.ts | grep -v "clearTimeout\|clearInterval"
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
2. **Async complexity** — Async operations appear unsynchronized but may be intentional
3. **Flexible equality** — `if (value == null)` is idiomatic for both null/undefined
4. **Intentional mutations** — MikroORM entities are designed to be mutable
5. **Configuration-driven** — Behavior controlled by external config

## Review Checklist

- [ ] All variables used have null/undefined checks
- [ ] Loop boundaries are correct (< vs <=, length checks)
- [ ] React state updates are synchronized, useEffect has cleanup
- [ ] Type comparisons are correct (=== for strict)
- [ ] All errors are caught and handled
- [ ] Logic flows are correct (no inverted conditions)
- [ ] Resources are cleaned up (listeners, timers, subscriptions)
- [ ] Edge cases handled (empty, single item, max values)

## Severity Guidelines

- **CRITICAL**: Null pointer exception, infinite loop, logic inversion causing wrong behavior
- **HIGH**: Race condition, off-by-one in critical path, unhandled error
- **MEDIUM**: Potential issue in edge case, missing edge case handling, type confusion
