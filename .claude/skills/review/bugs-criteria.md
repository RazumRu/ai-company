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
- MikroORM `em.findOne()` result used without null check

### 2. Off-By-One Errors
- Loop conditions: `i < array.length` vs `i <= array.length`
- Range checks: inclusive vs exclusive boundaries
- Substring positions: start/end indices
- Pagination: limit/offset calculations
- Timeout/delay calculations

**How to detect:**
```bash
# Loop patterns
grep -nE "for\s*\(\s*.*\s*(<=|>=|<|>|==)" file.ts
# Range validation
grep -n "indexOf\|slice\|substring" file.ts
```

### 3. State Management Issues
- Async state updates without synchronization
- Race conditions in concurrent operations
- React state mutations without immutability
- Missing state cleanup/disposal
- Stale closures capturing old state in React components
- Socket.IO event handler leaks (subscribe without unsubscribe)

**How to detect:**
- Look for multiple `setState` calls in same function
- Find async operations modifying shared state
- Identify `useEffect` hooks without cleanup functions
- Check for Socket.IO `.on()` without `.off()` in cleanup
- Look for BullMQ job handlers with shared mutable state

### 4. Type Safety Issues
- Type mismatches in comparisons (loose `==` for type-dependent logic)
- Implicit type coercions causing bugs
- Missing type validation for external inputs (use Zod DTOs)
- Unsafe `as` type assertions masking real type errors
- Return type mismatches

**How to detect:**
```bash
# Loose equality in comparisons
grep -nE "==\s|!=\s" file.ts | grep -v "==="
# Unsafe type assertions
grep -n "as any\|as unknown" file.ts
# Missing Zod validation at boundaries
grep -n "@Body()\|@Query()\|@Param()" file.ts | grep -v "Dto\|Schema"
```

### 5. Error Handling Gaps
- Try-catch blocks without finally/cleanup
- Errors silently caught and ignored
- Promise rejections not handled
- Missing `return await` in async functions (loses stack trace)
- NestJS exception filters not covering all cases

**How to detect:**
- Find `try` blocks followed by empty catch
- Look for unhandled Promise chains
- Check async functions for bare `return somePromise()` instead of `return await`
- Identify `@Catch()` decorators missing exception types

### 6. Logic Errors
- Inverted conditionals (`if (!condition)` when should be `if (condition)`)
- Wrong operator used (`&&` instead of `||`, `+` instead of `*`)
- Unreachable code after return/break/throw
- Duplicate/contradictory conditions
- Infinite loops or missing loop termination

**How to detect:**
```bash
# Find inverted conditions
grep -n "if\s*(\s*!" file.ts | grep -A2 "return\|throw"
# Find unreachable code
grep -n "return\|break\|throw" file.ts | grep -A1 "^"
```

### 7. Resource Leaks
- Database EntityManager forks not cleaned up
- Event listeners registered but not removed
- Timers not cleared
- Socket.IO connections not destroyed
- BullMQ workers not closed on shutdown
- Temporary files not cleaned up
- Docker containers not stopped (Dockerode)

**How to detect:**
```bash
# Event listeners without cleanup
grep -n "\.on(\|\.addEventListener(" file.ts
grep -n "\.off(\|\.removeListener\|\.removeEventListener(" file.ts
# Timers without clear
grep -n "setTimeout\|setInterval" file.ts | grep -v "clearTimeout\|clearInterval"
# EntityManager forks
grep -n "em.fork\|em.create" file.ts | grep -v "flush\|clear"
# useEffect cleanup
grep -n "useEffect" file.tsx | grep -A10 "return () =>"
```

### 8. Boundary Conditions
- Empty array/object handling
- Single-element edge cases
- Maximum/minimum value limits
- Negative number handling
- Division by zero

**How to detect:**
- Look for operations on `array[0]` without length check
- Find math operations that could have zero denominator
- Check boundary value comparisons

## Project-Specific Checks

- **MikroORM flush timing**: Check that `em.flush()` is called after entity mutations — forgetting flush means changes are lost
- **BullMQ job completion**: Verify job handlers don't swallow errors (causes silent failures in queue)
- **Socket.IO room cleanup**: Verify rooms are cleaned up when graphs/threads are deleted
- **Zod schema coverage**: New API endpoints must have Zod DTOs — raw `@Body()` without a DTO class is a bug

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
   - `if (obj && obj.field)` might be intentional for safety
   - Check if same pattern is used consistently elsewhere

2. **Async complexity** — Async operations appear unsynchronized but may be intentional
   - Check for explicit await statements
   - Look for Promise.all/race patterns

3. **Flexible equality** — `==` used for deliberate type coercion
   - `if (value == null)` is common for both null/undefined
   - Only flag if type coercion causes actual bugs

4. **Intentional mutations** — Some objects are designed to be mutable
   - MikroORM entities are mutable by design
   - Verify no unintended side effects

5. **Configuration-driven** — Behavior controlled by external config
   - Check if variables come from config files
   - Don't flag if properly validated at load time

6. **Legacy patterns** — Old code may have reasons for unusual patterns
   - Check comments or git history
   - Only flag if causes demonstrated bugs

## Review Checklist

- [ ] All variables used have null/undefined checks
- [ ] Loop boundaries are correct (< vs <=, length checks)
- [ ] Async state updates are synchronized
- [ ] Type comparisons are correct (=== for strict)
- [ ] All errors are caught and handled
- [ ] Logic flows are correct (no inverted conditions)
- [ ] Resources are cleaned up (listeners, timers, EntityManager forks)
- [ ] Edge cases handled (empty, single item, max values)

## Severity Guidelines

- **CRITICAL**: Null pointer exception, infinite loop, logic inversion causing wrong behavior
- **HIGH**: Race condition, off-by-one in critical path, unhandled error
- **MEDIUM**: Potential panic in edge case, missing edge case handling, type confusion
