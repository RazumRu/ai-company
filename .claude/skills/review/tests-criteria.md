# Tests Review Criteria

Test coverage analysis, edge case handling, test quality, and critical path coverage assessment.

## What to Check

### 1. Coverage Gaps
- Missing tests for new/modified code paths
- No tests for error conditions
- Missing happy-path tests
- Untested edge cases and boundary conditions
- No tests for async/concurrent scenarios

**How to detect:**
```bash
# Find test files corresponding to changed files
ls apps/api/src/__tests__/integration/ | grep -i "auth\|graph\|thread"
# Check if unit tests exist for modified code
for file in apps/api/src/v1/**/*.service.ts; do
  spec="${file%.ts}.spec.ts"
  [ ! -f "$spec" ] && echo "No test: $file"
done
# Look for test skips
grep -n "skip\|xit\|xdescribe\|it.skip" file.spec.ts
# Count assertions per test
grep -c "expect\|assert" file.spec.ts
```

**Red flags:**
- New code with no corresponding tests
- Modified functions without updated tests
- Skipped tests in main branch
- Single assertion per test file
- Tests only covering success cases

### 2. Missing Edge Cases
- Null/undefined input handling
- Empty collections (arrays, objects, strings)
- Boundary values (0, -1, max safe integer)
- Negative/invalid inputs
- Very large inputs
- Concurrent/race condition scenarios
- MikroORM entity state transitions

**How to detect:**
- Look at function parameters: are all edge cases tested?
- Check test names: do they mention edge cases?
- Count test cases per function (1-2 tests is likely insufficient)
- Look for `it.each` / `describe.each` table-driven tests covering ranges

**Red flags:**
- Only positive/happy-path tests
- No tests for `null`, `undefined`, `0`, `""`, `[]`
- No tests for concurrent calls
- Missing tests for error states
- No tests for MikroORM entity lifecycle events

### 3. Test Quality & Maintainability
- Brittle tests tied to implementation details
- Unclear test purposes (vague test names)
- Difficult to understand test setup
- Flaky tests (non-deterministic)
- Heavy use of mocks/stubs (indicates design issues)

**How to detect:**
```bash
# Find vague test names
grep -n "it\s*(\s*'[^']*" file.spec.ts | grep -iE "should work|test\d|does something"
# Find mocked dependencies
grep -n "vi.mock\|vi.fn\|vi.spyOn" file.spec.ts
# Count mocks per file
grep -c "vi.fn\|vi.mock\|vi.spyOn" file.spec.ts
```

**Red flags:**
- Test names: "test1", "shouldWork", "test_function"
- Setup takes more lines than the actual test
- Many mocks/stubs per test (indicates tight coupling)
- Tests that fail intermittently
- Comments like "this is fragile" or "fix this test"

### 4. Async/Promise Testing
- Missing async/await in async tests
- Unhandled promise rejections in tests
- Not testing error cases in async code
- Missing timeout handling in async tests
- Race conditions in test execution
- Socket.IO event-based async not tested
- BullMQ job handlers not tested with async patterns

**How to detect:**
```bash
# Find async tests without await
grep -n "async.*=>" file.spec.ts
grep -A5 "async.*=>" file.spec.ts | grep -v "await\|return"
# Promise tests without .catch
grep -n "\.then\|\.catch" file.spec.ts | grep -v ".catch"
# Socket.IO event tests
grep -n "socket\|emit\|on(" file.spec.ts
```

**Red flags:**
- Async test functions without `await`
- `.then()` without `.catch()` handling
- No timeout handling in async tests
- Tests that pass sometimes but fail others
- Missing error case tests for promises
- Socket.IO events not tested for race conditions

### 5. Integration Testing
- No integration tests for critical paths
- Integration tests only testing happy paths
- No database/service integration tests
- Missing end-to-end scenario tests
- Integration tests too brittle or slow

**How to detect:**
- Look for `*.int.ts` files in `apps/api/src/__tests__/integration/`
- Check if tests hit actual services or are mocked
- Look for `EntityManager` setup/teardown in tests
- Check for database transaction rollback in test cleanup

**Red flags:**
- All tests are unit tests (no integration coverage)
- Integration tests skipped or disabled
- Critical APIs not tested with real database
- Database operations only tested in isolation
- Missing E2E scenarios for critical user flows

### 6. Test Organization & Structure
- Tests grouped by file (not by functionality)
- No clear test suite organization
- Mixed unit and integration tests
- No setup/teardown or fixtures
- Inconsistent test structure across codebase

**How to detect:**
```bash
# Check test directory structure
find apps/api/src -name "*.spec.ts" | head -20
find apps/api/src/__tests__/integration -name "*.int.ts" | head -20
# Look for setup/teardown
grep -n "beforeEach\|afterEach\|beforeAll\|afterAll" file.spec.ts
# Count test suites
grep -c "describe" file.spec.ts
```

**Red flags:**
- Test directory mirrors source structure but nothing else
- No clear organization of test suites
- `beforeEach` has massive setup (100+ lines)
- Inconsistent test patterns across files
- Unit tests (`.spec.ts`) mixed with integration tests (`.int.ts`)

### 7. Mocking & Dependencies
- Over-mocking that defeats testing purpose
- Missing real integration tests (everything mocked)
- Mock objects not verifying behavior
- Mocks out of sync with real implementation
- `vi.fn()` without type safety

**How to detect:**
- Count mocks per test (more than 3-4 is a smell)
- Look for "happy-path-only" mocks
- Check if `vi.mocked()` is used for type-safe mocking
- Find tests that only mock everything
- Verify mocks match real interface using `Pick<ServiceType, 'methodName'>`

**Red flags:**
- Every dependency mocked
- Mocks that accept any arguments
- No assertion on mock calls/behavior
- Mocks with different API than real object
- Hard to understand what's being tested vs mocked

### 8. Critical Path Testing
- Core business logic not thoroughly tested
- Authentication/authorization paths undertested
- Graph compilation/execution logic not well covered
- Error recovery paths not tested
- User input validation paths not covered

**How to detect:**
- Identify critical paths in code (graph execution, thread management, agent runtime)
- Count test cases for each critical path
- Check if all branches in critical code are tested
- Look for error handling tests in critical functions
- Verify authorization checks are tested

**Red flags:**
- Graph execution logic with few test cases
- Auth code with no failure scenario tests
- Critical services with 1-2 tests
- No tests for recovery from failure states
- Permission/authorization gaps in tests

## Litmus Test (The Deletion Test)

For every test, ask: **"If I deleted the core logic this test covers, would the test still pass?"**

If the answer is yes, the test is worthless — it's testing mocks, trivial wiring, or nothing at all.

**How to apply:**
1. For each test touching changed code, mentally remove the implementation
2. Would the test fail? If not, the test needs strengthening
3. Common causes of false-passing tests:
   - Test only asserts that a `vi.fn()` was called (not that the result is correct)
   - Test asserts on default/initial values that don't change
   - Test has no assertions at all (just runs without error)

## Output Format

```json
{
  "type": "test",
  "severity": "critical|high|medium",
  "title": "Test coverage or quality issue",
  "file": "path/to/file.ts",
  "test_file": "path/to/test.spec.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description of test gap",
  "category": "coverage|edge_cases|quality|async|integration|organization|mocking|critical_path",
  "missing_tests": ["null input", "empty array", "timeout scenario"],
  "current_coverage": "What's currently tested",
  "recommendation": "What tests to add",
  "impact": "Risk if this isn't tested",
  "confidence": 88
}
```

## Common False Positives

1. **Intentional coverage gaps** — Some code doesn't need comprehensive testing
   - Glue code without logic might not need tests
   - UI display code often undertested (acceptable)
   - Check if code has significant logic

2. **Mocking is correct** — Using mocks isn't always a sign of bad design
   - External services should be mocked in unit tests
   - Real integration tests use real database (`.int.ts` files)
   - Check if mix of unit and integration tests exists

3. **Pragmatic testing** — Perfect test coverage is diminishing returns
   - 90% coverage threshold for lines/functions/statements, 80% for branches
   - Testing all branches can be overkill for simple code
   - Check project coverage thresholds

4. **Framework defaults** — NestJS provides built-in test utilities
   - `Test.createTestingModule()` handles DI wiring
   - Some patterns are auto-tested by the framework

5. **Test parameterization** — Multiple test cases might use compact syntax
   - `it.each` / `describe.each` cover many cases concisely
   - One "test" function might test many inputs
   - Count test cases, not test functions

## Review Checklist

- [ ] New/modified code has corresponding tests
- [ ] Tests cover happy path and error cases
- [ ] Edge cases tested (null, empty, boundaries)
- [ ] Async code tested with proper await
- [ ] Integration tests exist for critical paths (`.int.ts`)
- [ ] Test organization is clear and consistent
- [ ] Mocking is appropriate (not overused)
- [ ] Critical paths have comprehensive coverage
- [ ] Flaky tests are identified and fixed
- [ ] Litmus test: deleting core logic would cause test failure

## Severity Guidelines

- **CRITICAL**: No tests for critical business logic, no error handling tests
- **HIGH**: Coverage gap for modified code, missing edge case tests, integration gap
- **MEDIUM**: Missing tests for nice-to-have scenarios, minor coverage improvement, test quality issue
