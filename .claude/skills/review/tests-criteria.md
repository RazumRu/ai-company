# Tests Review Criteria

Test coverage analysis, edge case handling, test quality, and critical path coverage -- Vitest (unit `*.spec.ts`, integration `*.int.ts`), Cypress E2E (`*.cy.ts`), NestJS/Fastify, MikroORM, React 19.

## What to Check

### 1. Coverage Gaps

- Missing Vitest unit tests (`*.spec.ts`) for new or modified service/DAO/utility code
- No integration test (`*.int.ts`) update when existing integration tests cover a modified module
- Tests exist but do not cover the changed code paths (tests pass unchanged while the logic changed)
- No tests for error conditions (only happy-path coverage)
- Untested edge cases and boundary conditions
- New React component or hook with no corresponding `*.spec.ts` test file

**How to detect:**
```bash
# Find spec file for a source file
ls apps/api/src/v1/graphs/ | grep spec
# Check integration test directory
ls apps/api/src/__tests__/integration/ | grep graphs
# Look for test skips
grep -n "it\.skip\|xit\|xdescribe\|test\.skip" test_file.spec.ts
# Count assertions per test
grep -c "expect(" test_file.spec.ts
# Find React components without tests
ls apps/web/src/pages/graphs/components/ | grep -v spec
```

**Red flags:**
- New service method with no corresponding `describe` block in the `*.spec.ts` file
- Modified DAO method but `*.int.ts` file unchanged
- `it.skip` or `xit` in a file that will be merged to main
- Single `expect()` call covering a function with multiple branches
- Tests only covering the success path of a function that can throw
- New React component or custom hook with no test file alongside it

### 2. Missing Edge Cases

- Null/undefined inputs not tested
- Empty collections (`[]`, `{}`, `''`) not tested
- Boundary values (0, -1, `Number.MAX_SAFE_INTEGER`) not tested
- MikroORM `findOne` returning `null` -- service behavior under entity-not-found not tested
- Concurrent or race-condition scenarios in BullMQ job handlers
- React component receiving empty/null props not tested
- Hook receiving undefined dependencies not tested

**How to detect:**
- Look at function signatures: are `null`, `undefined`, `[]`, `''` covered by test cases?
- Check test names for words like "empty", "null", "not found", "invalid"
- Count test cases per function (1-2 tests usually insufficient for functions with guards)
- Check if Zod DTO validation failures are tested (what happens when invalid body is sent)
- Check if React component edge states (loading, error, empty data) are covered

**Red flags:**
- Service method that can throw `NotFoundException` with no test asserting it throws
- DAO method returning paginated results with no test for `total = 0`
- Zod DTO schema with no test that sends an invalid body and asserts HTTP 422
- BullMQ processor with no test for the failure path
- React component with conditional rendering but only one branch tested

### 3. Test Quality and Maintainability

- Brittle tests tied to implementation details (testing internal method calls rather than observable behavior)
- Vague test names (`it('should work')`, `it('test1')`)
- Complex test setup that obscures what is being tested
- Flaky tests that rely on real time (`setTimeout`, actual `Date.now()`) without fake timers
- Over-mocking: every dependency mocked such that the test proves nothing

**How to detect:**
```bash
# Vague test names
grep -n "it\s*(\s*['\"]should work\|it\s*(\s*['\"]test\b\|it\s*(\s*['\"]does" test_file.spec.ts
# Heavy mock setup (more than 4-5 vi.fn() per test)
grep -c "vi\.fn()\|vi\.mock(" test_file.spec.ts
# Real time dependencies
grep -n "setTimeout\|Date\.now\(\)" test_file.spec.ts | grep -v "vi\.useFakeTimers\|vi\.setSystemTime"
```

**Red flags:**
- Test name: `it('should work')`, `it('returns data')`, `it('test function')`
- `beforeEach` setup is longer than the test body
- `vi.mock('../service')` mocks the very thing being tested
- Test asserts `expect(mockFn).toHaveBeenCalled()` but never asserts the output
- Real `setTimeout` inside test without `vi.useFakeTimers()`

### 4. Async/Promise Testing (Vitest)

- Missing `async`/`await` in async Vitest tests
- Promise rejections not asserted (test passes even when service rejects)
- Error path tested with `.rejects.toThrow()` but wrong exception type asserted
- Missing cleanup of async resources between tests (MikroORM EM not cleared, BullMQ queue not drained)
- Socket.IO or WebSocket event tests without proper async resolution (event never fires, test times out)
- React hook tests with `renderHook` missing `waitFor` for async state updates

**How to detect:**
```bash
# Async tests missing await
grep -n "it\s*(\s*'.*',\s*async" test_file.spec.ts | grep -A5 "async" | grep -v "await"
# Promise not asserted
grep -n "service\.\|dao\." test_file.spec.ts | grep -v "await\|return\|expect("
# Missing .rejects
grep -n "throw\|NotFoundException\|BadRequestException" test_file.spec.ts | grep -v "rejects\|toThrow"
# renderHook without waitFor
grep -n "renderHook" test_file.spec.ts | grep -v "waitFor"
```

**Red flags:**
- `it('should fail', async () => { service.doThing() })` -- no `await`, rejection swallowed
- `expect(service.getById('missing')).resolves.toBeNull()` when service actually throws
- `afterEach` missing `em.clear()` or `await queue.drain()` causing test bleed
- Event-based assertions without `new Promise(resolve => socket.once(..., resolve))`
- `renderHook(() => useMyHook())` with no `await waitFor()` before asserting async state

### 5. Integration Testing (*.int.ts)

- No integration tests for critical service paths that involve real DB queries
- Integration tests only cover happy paths -- no failure/rollback scenarios
- Integration tests not run against real PostgreSQL (mocked DB defeats the purpose)
- Missing database cleanup between tests (`em.clear()`, transaction rollback, or truncate)
- New module added with integration tests in similar modules but none created for the new one
- Integration tests calling HTTP endpoints instead of hitting services directly (use E2E for HTTP)

**How to detect:**
```bash
# Integration test directory
ls apps/api/src/__tests__/integration/
# Check for beforeEach cleanup
grep -n "em\.clear\|truncate\|rollback\|afterEach" int_test_file.int.ts
# Check real DB usage (no vi.mock on EntityManager)
grep -n "vi\.mock\|vi\.fn(" int_test_file.int.ts | grep -i "entityManager\|em\b\|dao\b"
# Check for HTTP calls (should not be in integration tests)
grep -n "request\|supertest\|fetch\|axios" int_test_file.int.ts
```

**Red flags:**
- `vi.mock('../../dao/graph.dao')` in an integration test file -- defeats the purpose
- No `em.clear()` in `afterEach` -- entity identity map bleeds between tests
- Integration test for graphs module but no integration test for a new similarly complex module
- Only `getById` tested in integration -- missing `create`, `update`, `delete` paths
- Integration test using `supertest` or HTTP calls -- should call service methods directly

### 6. Mocking and Dependencies (Vitest)

- Over-mocking: entire service mocked when only one method is relevant
- `vi.mock` at file level not reset in `afterEach` -- bleeds into other test files
- Mock not matching the real interface (typed as `any` to bypass type check)
- Missing `vi.clearAllMocks()` or `vi.resetAllMocks()` between tests
- Mocking `DefaultLogger` as a no-op without verifying it was called with correct args
- NestJS unit tests not mocking DAOs via constructor injection pattern

**How to detect:**
```bash
# Check mock reset discipline
grep -n "vi\.clearAllMocks\|vi\.resetAllMocks\|vi\.restoreAllMocks" test_file.spec.ts
# Mocks typed as any
grep -n "as any\|as unknown as" test_file.spec.ts | grep "mock\|Mock\|vi\.fn"
# Module-level mocks
grep -n "vi\.mock(" test_file.spec.ts
# Missing afterEach with clearAllMocks
grep -c "afterEach" test_file.spec.ts
```

**NestJS unit test mocking pattern (correct):**
```typescript
describe('GraphsService', () => {
  let service: GraphsService;
  let graphDao: Pick<GraphDao, 'getOne' | 'getAll'>;

  beforeEach(() => {
    graphDao = { getOne: vi.fn(), getAll: vi.fn() };
    service = new GraphsService(graphDao as GraphDao);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return graph when found', async () => {
    vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
    const result = await service.getById(ctx, '123');
    expect(result.id).toBe('123');
    expect(graphDao.getOne).toHaveBeenCalledWith({ id: '123' });
  });
});
```

**Red flags:**
- `vi.fn() as any` -- bypasses interface conformance check; mock may diverge from real implementation
- No `vi.clearAllMocks()` in `afterEach` when `vi.fn()` state matters between tests
- Entire `GraphsService` mocked in a controller test when only `getById` is called -- other methods return `undefined` silently
- Mock object missing methods present on the real class -- TypeScript would catch this if typed correctly
- NestJS test using `Test.createTestingModule()` for a simple unit test when constructor injection suffices

### 7. React and Frontend Testing

- React component tests not using `@testing-library/react` (`render`, `screen`, `fireEvent`, `waitFor`)
- Custom hook tests not using `renderHook` from `@testing-library/react`
- Component tests asserting on implementation details (internal state, class names) instead of user-visible behavior
- Missing cleanup between React component tests (renders not unmounted)
- WebSocket hook tests not mocking `WebSocketService` properly
- Tests querying by test ID or class name instead of accessible roles/text

**How to detect:**
```bash
# Check testing-library usage
grep -n "render\|screen\|fireEvent\|renderHook\|waitFor" test_file.spec.ts
# Check for implementation detail testing
grep -n "\.state\|\.instance\|\.classList\|\.className" test_file.spec.ts
# Check for proper hook testing
grep -n "renderHook\|act(" test_file.spec.ts
# Check for querySelector anti-pattern
grep -n "querySelector\|getElementsBy" test_file.spec.ts
```

**Correct patterns:**
```typescript
// Component test
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

describe('GraphCanvas', () => {
  it('should render node when added', async () => {
    render(<GraphCanvas graph={mockGraph} />);
    expect(screen.getByText('Agent Node')).toBeInTheDocument();
  });

  it('should call onDelete when delete button clicked', async () => {
    const onDelete = vi.fn();
    render(<GraphCanvas graph={mockGraph} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(mockGraph.id);
  });
});

// Hook test
import { renderHook, waitFor } from '@testing-library/react';

describe('useWebSocket', () => {
  it('should connect and receive messages', async () => {
    const { result } = renderHook(() => useWebSocket(mockConfig));
    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });
});
```

**Red flags:**
- `document.querySelector('.my-class')` instead of `screen.getByRole()` or `screen.getByText()`
- `wrapper.instance().setState(...)` -- testing implementation, not behavior
- Missing `await waitFor()` after state-changing actions in async component tests
- Hook test that directly calls the hook function instead of using `renderHook`
- Component test not wrapping state updates in `act()`

### 8. E2E and Critical Path Testing (Cypress)

**E2E requirements:**
- New endpoints must have Cypress E2E coverage in `cypress/e2e/`
- API types must be regenerated before writing E2E tests (`pnpm test:e2e:generate-api`)
- E2E tests must import types from `../../api-definitions`, never define inline types
- Must use `cy.task('log', message)` for important assertions (aids CI debugging)
- No `it.skip` or conditional skips based on env vars -- must-fail policy applies

**Critical path coverage:**
- Authentication/authorization paths undertested (no test that a non-owner cannot access a resource)
- Graph compilation/execution lifecycle not covered by integration tests
- BullMQ job processor not tested for retry behavior or DLQ handling
- Zod DTO validation not tested (HTTP 422 for invalid input)
- WebSocket/Socket.IO event emission not asserted in notification tests

**How to detect:**
```bash
# Check api-definitions usage in Cypress specs
grep -n "import.*from\|import type" cypress_spec.cy.ts | grep -v "api-definitions"
# Look for inline type definitions in Cypress specs
grep -n "^type \|^interface " cypress_spec.cy.ts
# Check for conditional skips
grep -n "it\.skip\|cy\.skip\|Cypress\.env\b" cypress_spec.cy.ts
# Auth failure scenarios
grep -n "403\|401\|Forbidden\|Unauthorized" test_file.spec.ts
# DTO validation tests
grep -n "422\|ZodError\|validation" test_file.spec.ts
# Socket emission asserted
grep -n "emit\|socket\." test_file.spec.ts
# Check for cy.task('log') usage
grep -n "cy\.task\|cy\.log" cypress_spec.cy.ts
```

**Red flags:**
- `import type { GraphDto } from '../../../src/v1/graphs/dto/graph.dto'` -- must come from `../../api-definitions`
- `interface CreateGraphResponse { ... }` defined inline in a Cypress spec file
- `if (!Cypress.env('API_URL')) { return; }` -- silent skip, must be a hard failure instead
- `console.log()` in Cypress tests instead of `cy.task('log', message)`
- Graph service tests with no test that verifies `NotFoundException` for another user's graph
- BullMQ processor tests with no test for the error re-throw behavior
- Controller tests with no test sending an invalid DTO body and asserting HTTP 422
- Notification service with no assertion that `server.emit()` was called with the right event/payload

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
  "category": "coverage|edge_cases|quality|async|integration|mocking|react|critical_path_e2e",
  "missing_tests": ["null entity result", "invalid DTO body (422)", "authorization failure"],
  "current_coverage": "What is currently tested",
  "recommendation": "What tests to add",
  "impact": "Risk if this is not tested",
  "confidence": 88
}
```

## Common False Positives

1. **Intentional coverage gaps** -- Not all code needs comprehensive testing
   - Thin controller methods that only delegate to service (validated by integration tests) may not need a unit spec
   - Auto-generated code in `src/autogenerated/` must never be tested directly

2. **Mocking external services is correct** -- Unit tests should mock Qdrant, LiteLLM, and Redis clients
   - Only flag over-mocking when the DAO or EntityManager itself is mocked in a unit test for a service that has real logic

3. **Pragmatic coverage** -- 100% branch coverage has diminishing returns
   - Check the project's configured threshold (90% lines/functions/statements, 80% branches) before flagging
   - Trivial getters/setters may not warrant dedicated tests

4. **Test parameterization** -- A `it.each` or `describe.each` block covers many cases concisely
   - Count test cases (rows in the table), not `it()` function calls

5. **Documented limitations** -- Some edge cases may be known and deferred
   - Check comments or linked issues; don't flag if explicitly deferred with justification

6. **Integration test database setup** -- Transactions or seed data in `beforeAll` are intentional
   - Large `beforeAll` in integration tests is expected for DB seeding; flag large `beforeEach` instead

## Litmus Test (The Deletion Test)

For every test, ask: **"If I deleted the core logic this test covers, would the test still pass?"**

If the answer is yes, the test is worthless -- it is testing mocks, trivial wiring, or nothing at all.

**How to apply:**
1. For each test touching changed code, mentally remove the implementation
2. Would the test fail? If not, the test needs strengthening
3. Common causes of false-passing tests:
   - Test only asserts that a `vi.fn()` was called, not that the result is correct
   - Test asserts on default/initial values that the implementation never changes
   - Test has zero `expect()` calls (just runs without error)
   - Test imports the module but the changed code path is never exercised

**Red flags:**
- Tests with 0 `expect()` calls
- Tests that only call `expect(mockFn).toHaveBeenCalled()` without asserting return value
- `expect(result).toBeDefined()` -- passes even when result is `undefined`
- "Smoke tests" that import a module and assert `result !== null`

## Review Checklist

- [ ] New or modified service/DAO has updated `*.spec.ts` test
- [ ] Modified code covered by existing `*.int.ts` has that file updated
- [ ] Tests cover both happy path and error/exception path
- [ ] Edge cases tested (null entity, empty collection, zero pagination, invalid DTO)
- [ ] All async tests properly `await` and assert rejections with `.rejects.toThrow()`
- [ ] Integration tests use real MikroORM EM (not mocked) and clean up with `em.clear()`
- [ ] Integration tests call services directly, not HTTP endpoints
- [ ] Test organization correct: `*.spec.ts` colocated, `*.int.ts` in integration directory
- [ ] Mocks typed correctly (no `as any` bypass) and reset in `afterEach` with `vi.clearAllMocks()`
- [ ] NestJS unit tests mock DAOs via constructor injection, not `Test.createTestingModule()`
- [ ] React component tests use `@testing-library/react` and query by role/text, not class/ID
- [ ] React hook tests use `renderHook` with `waitFor` for async state
- [ ] Critical auth/authorization paths include failure scenario tests
- [ ] E2E tests import types from `../../api-definitions`, not inline definitions
- [ ] E2E tests use `cy.task('log', message)` for terminal output, not `console.log()`
- [ ] No `it.skip` or conditional early returns -- prerequisites must cause hard failure
- [ ] Tests never run full suites -- always target specific files
- [ ] Tests invoked via pnpm scripts (`pnpm test:unit`, `pnpm test:integration {file}`) -- never via `vitest` or `npx vitest` directly
- [ ] Litmus test: deleting core logic would cause the test to fail

## Severity Guidelines

- **CRITICAL**: No tests for auth/authorization logic, no tests for critical business logic (graph execution, job processing), async test missing `await` (silently passes)
- **HIGH**: Coverage gap for modified code path, missing error/exception path tests, integration test missing for complex module, `vi.clearAllMocks()` missing causing test pollution, E2E test with inline types instead of `../../api-definitions`
- **MEDIUM**: Missing edge case tests, weak assertions (no return value checked), test organization violation, React test querying by class name instead of role, missing `cy.task('log')` in E2E
