# Tests Review Criteria

Test coverage analysis, edge case handling, test quality, and critical path coverage for Vitest (unit + integration).

## What to Check

### 1. Coverage Gaps
- Missing tests for new/modified code paths
- No tests for error conditions
- Untested edge cases and boundary conditions

**How to detect:**
```bash
# Find source files without corresponding test files
for file in apps/api/src/v1/**/*.ts; do
  base=$(basename "$file" .ts)
  [ ! -f "${file%.ts}.spec.ts" ] && echo "No unit test: $file"
done
# Look for test skips
grep -n "skip\|xit\|xdescribe\|it.todo" file.spec.ts
```

### 2. Missing Edge Cases
- Null/undefined input handling
- Empty collections
- Boundary values (0, -1, max values)
- MikroORM entity not found scenarios
- Concurrent BullMQ job processing

### 3. Test Quality & Maintainability
- Brittle tests tied to implementation details
- Unclear test purposes (vague test names)
- Heavy use of mocks

**How to detect:**
```bash
# Find vague test names
grep -n "it\s*(\s*'[^']*'" file.spec.ts | grep -iE "should work|should pass|test\d"
# Find mocked dependencies
grep -n "vi.mock\|vi.spyOn\|vi.fn" file.spec.ts
```

### 4. Async/Promise Testing
- Missing `await` in async tests
- Unhandled promise rejections
- Not testing error cases in async service methods

### 5. Integration Testing
- No integration tests for critical service paths
- Missing database integration tests for DAO methods
- Integration tests not targeting specific files

### 6. Test Organization & Structure
- Unit tests (`*.spec.ts`) not placed next to source file
- Integration tests (`*.int.ts`) not in `src/__tests__/integration/`
- E2E tests (`*.cy.ts`) not in `apps/api/cypress/e2e/`

### 7. Mocking & Dependencies
- Over-mocking that defeats testing purpose
- Vitest mocks not verifying behavior

### 8. Critical Path Testing
- Graph compilation/deployment logic not thoroughly tested
- Agent execution paths undertested
- Thread/message handling not well covered

## Litmus Test (The Deletion Test)

For every test, ask: **"If I deleted the core logic this test covers, would the test still pass?"**

If yes, the test is worthless.

## Output Format

```json
{
  "type": "test",
  "severity": "critical|high|medium",
  "title": "Test coverage or quality issue",
  "file": "path/to/file.ts",
  "test_file": "path/to/file.spec.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description of test gap",
  "category": "coverage|edge_cases|quality|async|integration|organization|mocking|critical_path",
  "missing_tests": ["null input", "empty array", "entity not found"],
  "recommendation": "What tests to add",
  "confidence": 88
}
```

## Common False Positives

1. **Intentional coverage gaps** — Thin controllers without logic might not need tests
2. **Mocking is correct** — External services (LiteLLM, Qdrant) should be mocked in unit tests
3. **Pragmatic testing** — 90% coverage threshold
4. **Test parameterization** — `it.each` covers many cases concisely

## Review Checklist

- [ ] New/modified code has corresponding `*.spec.ts` tests
- [ ] Tests cover happy path and error cases
- [ ] Edge cases tested (null, empty, boundaries, entity not found)
- [ ] Async code tested with proper await
- [ ] Integration tests exist for critical DAO/service paths
- [ ] Test organization follows convention
- [ ] Litmus test: deleting core logic would cause test failure

## Severity Guidelines

- **CRITICAL**: No tests for critical business logic (graph execution, agent runtime)
- **HIGH**: Coverage gap for modified code, missing edge case tests
- **MEDIUM**: Missing tests for nice-to-have scenarios, test quality issue
