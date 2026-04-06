# Tests Review Criteria

Test coverage analysis, edge case handling, test quality, and critical path coverage for Vitest + Cypress.

## What to Check

### 1. Coverage Gaps
- Missing tests for new/modified code paths
- No tests for error conditions
- Missing happy-path tests
- Untested edge cases

**How to detect:**
```bash
find apps/api/src -name "*.spec.ts" | grep -i "graph\|thread\|agent"
find apps/api/src/__tests__/integration -name "*.int.ts"
grep -n "it.skip\|xit\|xdescribe" file.spec.ts
```

**Red flags:**
- New code with no corresponding tests
- Modified functions without updated tests
- Skipped tests in main branch
- Tests only covering success cases

### 2. Missing Edge Cases
- Null/undefined input handling
- Empty collections
- Boundary values (0, -1, max values)
- Concurrent/race condition scenarios

### 3. Test Quality & Maintainability
- Vague test names ("should work", "test something")
- Heavy mocking defeating testing purpose
- Tests tied to implementation details

**How to detect:**
```bash
grep -n "it\s*(\s*'[^']*'" file.spec.ts | grep -E "should work|do something|test"
grep -n "vi.fn()\|vi.mock\|vi.spyOn\|mock<" file.spec.ts
```

### 4. Async/Promise Testing
- Missing `await` in async tests
- Unhandled promise rejections
- Missing timeout handling

**How to detect:**
```bash
grep -n "async.*=>" file.spec.ts
grep -A5 "async.*=>" file.spec.ts | grep -v "await\|return"
```

### 5. Integration Testing
- No integration tests for critical paths
- Integration tests only testing happy paths
- Proper use of `createTestModule()` from setup

### 6. Test Organization
- Consistent Vitest structure (`describe`/`it`/`beforeEach`)
- Proper mock setup in `beforeEach`
- Cleanup in `afterEach`/`afterAll`

### 7. Mocking & Dependencies
- Over-mocking defeating testing purpose
- `Pick<Service, 'method'>` pattern for type-safe mocks
- `vitest-mock-extended` used correctly

### 8. Critical Path Testing
- Graph compilation/execution paths
- Agent workflow paths
- Thread/message persistence
- Authentication/authorization paths

## Litmus Test (The Deletion Test)

**"If I deleted the core logic this test covers, would the test still pass?"**

**Red flags:**
- Tests with 0 assertions
- Tests that only verify mock call counts
- Tests where removing `expect()` doesn't cause failure

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
  "description": "Description of test gap",
  "category": "coverage|edge_cases|quality|async|integration|organization|mocking|critical_path",
  "missing_tests": ["null input", "empty array"],
  "recommendation": "What tests to add",
  "impact": "Risk if not tested",
  "confidence": 88
}
```

## Common False Positives

1. **Intentional coverage gaps** — Glue code without logic
2. **Correct mocking** — External services should be mocked in unit tests
3. **Pragmatic testing** — 90% coverage target
4. **MikroORM entities** — Simple entity definitions don't need dedicated tests

## Review Checklist

- [ ] New/modified code has corresponding tests
- [ ] Tests cover happy path and error cases
- [ ] Edge cases tested (null, empty, boundaries)
- [ ] Async code tested with proper await
- [ ] Integration tests exist for critical paths
- [ ] Mocking is appropriate (not overused)
- [ ] Litmus test: deleting core logic would cause test failure

## Severity Guidelines

- **CRITICAL**: No tests for critical business logic, no error handling tests
- **HIGH**: Coverage gap for modified code, missing edge case tests
- **MEDIUM**: Minor coverage improvement, test quality issue
