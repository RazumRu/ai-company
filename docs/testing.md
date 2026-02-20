# Testing Guidelines

This document explains how to run and write tests for the Geniro API project.

## Overview

The project uses two testing frameworks:
- **Vitest** for unit tests (and optional integration tests)
- **Cypress** for E2E (end-to-end) tests

### Critical rules

1. **Always use package.json scripts** to run tests. Never call test runners directly (e.g. `vitest`, `npx vitest`, `pnpm vitest run`).
2. **Never run full test suites**:
   - `pnpm test` — **FORBIDDEN** (runs everything)
   - `pnpm test:integration` (without a filename) — **FORBIDDEN** (runs all integration tests)
   - Always target a specific scope: `pnpm test:unit`, `pnpm test:integration {filename}`, or `pnpm test:e2e:local --spec "path"`.

## Full project check (mandatory)

Before considering any task "done" (before opening/merging a PR or marking work complete), you must run the full project check locally and ensure it passes:

```bash
pnpm run full-check
```

This command will:
- Build the project
- Run linting (and apply safe fixes)
- Build test targets
- Run unit tests

If any step fails, fix the issues and re-run the command until it completes successfully.

## Unit Testing

### Running Unit Tests

The project uses Vitest for unit testing. Always use the package.json script — never call `vitest` directly.

```bash
# ✅ Correct
pnpm test:unit

# ❌ WRONG — never call vitest directly
# vitest run
# npx vitest
# pnpm vitest run
# pnpm test                    # runs everything — FORBIDDEN
```

### Writing Unit Tests

1. **File naming**: Create test files with `.spec.ts` extension
2. **Location**: Place test files next to the files they test
3. **Framework**: Use Vitest's testing utilities

Example structure:
```
src/v1/users/
├── users.service.ts
├── users.service.spec.ts  # Unit test
├── users.dao.ts
└── users.dao.spec.ts      # Unit test
```

### Prefer Updating Existing Test Files

When adding new tests for a feature/module/API that already has test coverage:

- Prefer updating the existing test file and add new test cases to the appropriate describe block instead of creating a new file.
- Only create a new test file when the scope is clearly different (e.g., a new feature area, different module, or the existing file has become too large and logically split by domain).
- Benefits: avoids duplication, keeps related scenarios together, simplifies maintenance and discovery.

Examples:
- Unit tests: if src/v1/users/users.service.spec.ts exists and you add more service methods, add new `describe/it` blocks there rather than creating another users.service.more.spec.ts.
- E2E tests: if apps/api/cypress/e2e/users/users.cy.ts exists and you add new user flows, extend that file (or its existing suites) instead of creating users-new.cy.ts.

## Integration Testing

### Overview

> **Important**: Integration tests are **mandatory** when modifying code that already has integration tests. Always run the **specific** integration test file — never the full suite.
>
> ```bash
> # ✅ Correct — always target a specific file
> pnpm test:integration src/__tests__/integration/agent-tools/files-tools.int.ts
>
> # ❌ NEVER run bare pnpm test:integration without a filename
> pnpm test:integration
> ```

Integration tests are deep, comprehensive tests that verify the detailed behavior of business logic by calling services directly. They differ from E2E tests in purpose and scope:

**E2E Tests (Cypress)** - `cypress/e2e/*.cy.ts`
- Test basic endpoint functionality and reachability
- Verify HTTP request/response flows work correctly
- Check basic validation and error handling
- Test that endpoints are accessible and return expected status codes
- **Purpose**: Smoke testing to ensure general functionality works

**Integration Tests (Vitest)** - `src/__tests__/integration/*.int.ts`
- Deep dive into business logic and edge cases
- Test complex workflows and state transitions
- Verify detailed behavior of services and their interactions
- Test asynchronous operations and side effects
- **Purpose**: Comprehensive testing of all aspects of business logic

| Aspect | Integration Tests | E2E Tests |
|--------|------------------|-----------|
| **Location** | `src/__tests__/integration/` | `cypress/e2e/` |
| **Purpose** | Detailed business logic testing | Basic endpoint validation |
| **Execution** | Direct service calls | HTTP requests |
| **Speed** | Fast | Slower |
| **Coverage** | Comprehensive scenarios, edge cases, state transitions | Smoke tests, endpoint reachability, basic validation |
| **When to use** | Complex workflows, business logic validation, async operations | Verify endpoints work, basic CRUD operations, general validation |
| **Example** | Testing revision status transitions through multiple states | Testing that POST /graphs returns 201 and validates required fields |

### Running Integration Tests

Always use the package.json script and **always target a specific file**.

```bash
# ✅ Correct — always target a specific file
pnpm test:integration src/__tests__/integration/agent-tools/files-tools.int.ts

# ✅ Correct — run a specific case within a file
pnpm test:integration src/__tests__/integration/graphs/graph-lifecycle.int.ts -t "specific test"

# ✅ Correct — run only unit tests
pnpm test:unit

# ❌ WRONG — NEVER run all integration tests
# pnpm test:integration
# pnpm test
```

### Writing Integration Tests

Integration tests should be placed in `src/__tests__/integration/` with the `.int.ts` extension.

**File naming**: Create test files with `.int.ts` extension (e.g., `graph-lifecycle.int.ts`)

**Location structure**:
```
src/__tests__/
├── integration/
│   ├── helpers/
│   │   └── graph-helpers.ts     # Helper utilities for test data
│   ├── graphs/
│   │   ├── graph-lifecycle.int.ts
│   │   ├── graph-validation.int.ts
│   │   └── graph-revisions.int.ts
│   ├── threads/
│   │   └── thread-management.int.ts
│   └── notifications/
│       └── socket-notifications.int.ts
└── README.md
```

**Key principles**:
1. Each test file sets up its own `TestingModule` and `NestApplication` instance
2. Get service instances directly from the test module using `moduleRef.get<ServiceType>(ServiceClass)`
3. Call service methods directly instead of making HTTP requests
4. Always clean up created resources in `afterEach` or `afterAll`
5. Override `AuthContextService` to provide test user credentials
6. Use existing DTOs and types from the codebase

**Basic structure example**:
```typescript
import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { GraphRevisionService } from '../../../v1/graphs/services/graph-revision.service';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Graph Revisions Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let revisionsService: GraphRevisionService;
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    revisionsService = app.get<GraphRevisionService>(GraphRevisionService);
  });

  afterEach(async () => {
    // Cleanup all created graphs
    for (const graphId of createdGraphIds) {
      try {
        await graphsService.destroy(graphId);
      } catch {
        // Graph might not be running
      }
      try {
        await graphsService.delete(graphId);
      } catch {
        // Graph might already be deleted
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies a revision to a running graph', { timeout: 40000 }, async () => {
    const graphData = createMockGraphData();

    const createResponse = await graphsService.create(graphData);
    createdGraphIds.push(createResponse.id);

    await graphsService.run(createResponse.id);

    // Test logic here...
  });
});
```

For more detailed examples and patterns, see `src/__tests__/README.md`.

## E2E Testing

### Running E2E Tests

The project uses Cypress for E2E testing.

**Important**: Before running E2E tests, ensure the server is running and dependencies are up.

#### Complete E2E Test Workflow

1. **Start dependencies**:
   ```bash
   pnpm deps:up
   ```
   This uses Podman by default. If you prefer Docker:
   ```bash
   docker compose up -d
   ```

2. **Check if the server is already running**:
   ```bash
   # returns HTTP/1.1 200 if the API is up
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/health/check
   ```
   - If you see 200, the server is up — you can skip the start step below.
   - If you get anything else, start the server.

3. **Start the server in background (if not running)**:
   ```bash
   cd apps/api
   pnpm start:dev &
   # or in a separate terminal:
   pnpm start:dev
   ```

4. **Wait for server to be ready**:
   ```bash
   sleep 10 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/health/check
   ```

5. **Run E2E tests**:
   ```bash
   # from apps/api
   cd apps/api
   pnpm run test:e2e:local
   ```

#### E2E Test Commands

- Run E2E tests against a local server:
  ```bash
  cd apps/api
  pnpm test:e2e:local
  ```

- Generate API definitions from Swagger:
  ```bash
  cd apps/api
  pnpm test:e2e:generate-api
  ```

**Important**: Before running E2E tests or generating API definitions, always run the script that generates the API types:
```bash
cd apps/api
pnpm test:e2e:generate-api
```

> The generated files must never be edited or recreated by hand—rerun the script whenever the Swagger schema changes.

### Speeding up E2E locally: run one spec at a time

When iterating locally, prefer running specs one-by-one to get fast feedback, fix the failure, and then continue. This avoids rerunning the whole suite after each change.

- Run a single spec (recommended):
  ```bash
  cd apps/api
  pnpm test:e2e:local --spec "cypress/e2e/notifications/socket.cy.ts"
  ```
  You can replace the path with any spec you’re working on.

- List available spec files:
  ```bash
  cd apps/api
  find cypress/e2e -type f \( -name "*.cy.ts" -o -name "*.cy.js" \) | sort
  ```

Workflow suggestion:
1) Pick one spec and run it; 2) Fix the failure; 3) Re-run until green; 4) Move to the next spec.

### Focus on changed E2E scenarios first

- **Isolate the exact tests you touched**: Use Cypress's `describe.only`, `it.only`, or temporary `it.skip`/`describe.skip` while developing to run only the block you're editing. This keeps feedback quick.
- **Example (temporary)**:
  ```ts
  describe.only('notifications flow', () => {
    it('sends a push notification', () => {
      // ... test code ...
    });

    it.skip('queues a fallback email', () => {
      // temporarily skipped while iterating; remove before commit
    });
  });
  ```
- **Run the spec file in isolation** once the focused test passes:
  ```bash
  cd apps/api
  pnpm test:e2e:local --spec "cypress/e2e/notifications/socket.cy.ts"
  ```
- **Remove all `.only`/`.skip` tags** before committing and run the spec without filters to ensure the full suite for that file passes.
- **Finish by running your usual broader command** (e.g. `pnpm test:e2e:local`) when you are ready for final verification.

### Writing E2E Tests

1. **File naming**: Create test files with `.cy.ts` extension
2. **Location**: Place them in `apps/api/cypress/e2e/` directory
3. **Helper functions**: Use the helper functions in corresponding `.helper.ts` files
4. **API definitions**: Use generated API definitions from `apps/api/cypress/api-definitions/`

#### Logging from E2E tests

- You can log arbitrary messages from your Cypress tests to the terminal output using a predefined task:
  ```ts
  // inside your test
  cy.task('log', 'Starting templates test...');
  cy.task('log', `Payload: ${JSON.stringify(payload)}`);
  ```
  Where you will see it:
  - When running via pnpm test:e2e, these logs appear in the terminal running Cypress.
  - This works because apps/api/cypress/cypress.config.ts defines a `task` named `log` that proxies to console.log.

Example structure:
```
apps/api/cypress/
├── e2e/
│   ├── users/
│   │   ├── users.cy.ts        # E2E test
│   │   └── users.helper.ts    # Helper functions
│   └── auth/
│       ├── auth.cy.ts
│       └── auth.helper.ts
└── api-definitions/           # Generated API types
```

## Testing Best Practices

### Unit Tests

- **Test behavior, not implementation**: Focus on what the function does, not how
- **Use meaningful test names**: Describe what is being tested
- **One assertion per test**: Keep tests focused
- **Mock external dependencies**: Isolate the unit being tested
- **Test edge cases**: Include tests for error conditions and boundary values

**Example of a good test** (verifies business logic):
```typescript
it('should merge non-conflicting changes successfully', () => {
  const baseSchema = { nodes: [{ id: 'node-1', config: { value: 'original' } }], edges: [] };
  const headSchema = { nodes: [{ id: 'node-1', config: { value: 'head-changed' } }], edges: [] };
  const clientSchema = {
    nodes: [
      { id: 'node-1', config: { value: 'original' } },
      { id: 'node-2', config: { value: 'client-new' } }
    ],
    edges: []
  };

  const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

  expect(result.success).toBe(true);
  expect(result.mergedSchema!.nodes).toHaveLength(2);
  expect(result.mergedSchema?.nodes[0]?.config).toEqual({ value: 'head-changed' });
  expect(result.conflicts).toHaveLength(0);
});
```

**Example of a bad test** (just checks mocks work, doesn't verify logic):
```typescript
// BAD: This doesn't test merge logic, just that mocks return expected values
it('should call merge function', () => {
  const mockMerge = vi.fn().mockReturnValue({ success: true });
  service.merge = mockMerge;

  service.merge(base, head, client);

  expect(mockMerge).toHaveBeenCalled(); // So what? This tests nothing about correctness
});
```

### E2E Tests

- **Test user flows**: Simulate real user interactions
- **Use realistic data**: Test with data similar to production
- **Clean up after tests**: Delete test data created during tests
- **Independent tests**: Each test should be able to run independently
- **Avoid hardcoded waits**: Use Cypress commands that wait for elements

**Example of a good E2E test** (verifies API endpoint behavior):
```typescript
describe('POST /v1/graphs', () => {
  it('should create a new graph', () => {
    const graphData = createMockGraphData();

    createGraph(graphData).then((response) => {
      expect(response.status).to.equal(201);
      validateGraph(response.body);
      createdGraphId = response.body.id;
    });
  });

  it('should return 400 for duplicate node IDs', () => {
    const invalidGraphData = createMockGraphData({
      schema: {
        nodes: [
          { id: 'duplicate-id', template: 'docker-runtime', config: { image: 'python:3.11' } },
          { id: 'duplicate-id', template: 'docker-runtime', config: { image: 'python:3.11' } },
        ],
        edges: [],
      },
    });

    createGraph(invalidGraphData).then((response) => {
      expect(response.status).to.equal(400);
      expect(response.body.message).to.include('Duplicate node IDs found in graph schema');
    });
  });
});
```

**Example of a bad E2E test** (tests implementation details, not behavior):
```typescript
// BAD: E2E tests should not verify internal implementation
it('should call validateSchema method', () => {
  cy.spy(graphService, 'validateSchema'); // Don't spy on internals in E2E
  createGraph(graphData);
  expect(graphService.validateSchema).to.have.been.called;
});
```

### Integration Tests

- **Test real scenarios**: Focus on actual use cases and workflows, not isolated units
- **Direct service calls**: Use services directly rather than HTTP requests
- **Clean up resources**: Always clean up created resources to avoid test pollution
- **Test state transitions**: Verify complex state changes and async operations
- **Edge cases and business logic**: Go deep into all aspects of business logic
- **Independent tests**: Each test should be able to run independently

**Example of a good integration test** (verifies complete business workflow):
```typescript
it('applies a revision to a running graph', { timeout: 40000 }, async () => {
  const graphData = createMockGraphData();
  const newInstructions = 'Updated instructions for live revision';

  // Create and run graph
  const createResponse = await graphsService.create(graphData);
  const graphId = createResponse.id;
  createdGraphIds.push(graphId);
  await graphsService.run(graphId);
  await waitForGraphToBeRunning(graphId);

  // Update schema to create a revision
  const updatedSchema = cloneDeep(createResponse.schema);
  updatedSchema.nodes = updatedSchema.nodes.map((node) =>
    node.id === 'agent-1'
      ? { ...node, config: { ...node.config, instructions: newInstructions } }
      : node
  );

  const updateResponse = await graphsService.update(graphId, {
    schema: updatedSchema,
    currentVersion: createResponse.version,
  });

  // Wait for revision to be applied
  const revision = await waitForRevisionStatus(
    graphId,
    updateResponse.revision!.id,
    GraphRevisionStatus.Applied
  );

  // Verify the business logic: version incremented and schema updated
  expect(compare(createResponse.version, revision.toVersion)).toBe(-1);
  expect(revision.error).toBeUndefined();

  const updatedGraph = await graphsService.findById(graphId);
  expect(updatedGraph.version).toBe(revision.toVersion);
  const agentNode = updatedGraph.schema.nodes.find(n => n.id === 'agent-1');
  expect(agentNode?.config.instructions).toBe(newInstructions);
});
```

**Example of a bad integration test** (just checks CRUD operations work):
```typescript
// BAD: This doesn't test any real business logic, just basic DB operations
it('should create and retrieve a graph', async () => {
  const graph = await graphsService.create(graphData);
  createdGraphIds.push(graph.id);

  const retrieved = await graphsService.findById(graph.id);

  expect(retrieved.id).toBe(graph.id); // So what? This just tests TypeORM works
  expect(retrieved.name).toBe(graph.name); // Not testing any business rules
});
```

### General

- **Keep tests fast**: Unit tests should run in milliseconds
- **Maintain tests**: Update tests when code changes
- **Fix failing tests immediately**: Don't ignore or skip failing tests
- **Use descriptive assertions**: Make it clear what is expected
- **Always review tests critically**: Make sure they verify real logic, not just match broken behavior. Avoid cargo-cult, brittle, or bug-preserving tests that only keep the suite green instead of keeping the product correct

### No Conditional Testing or Skips (Must-Fail Policy)

- Do not write tests that conditionally skip or pass based on environment, data availability, or external setup.
- If a prerequisite (environment variable, external service, seed data, docker dependency) is missing or misconfigured, the test MUST fail. Do not skip.
- Rationale: Conditional/skipped tests hide real issues and create false confidence. We prefer fast feedback and explicit failures so problems are fixed early.

Anti-patterns (do NOT do):

- Cypress
  - Avoid patterns like:
    ```ts
    const token = Cypress.env('GITHUB_PAT_TOKEN');
    if (!token) {
      // this is NOT allowed
      cy.log('Skipping test: missing token');
      return; // or this.skip()
    }
    ```
  - Avoid conditional describes/its:
    ```ts
    (Cypress.env('FLAG') ? describe : describe.skip)('suite', () => { /* ... */ })
    ```

- Vitest
  - Avoid:
    ```ts
    if (!process.env.SOME_REQUIRED_VAR) {
      it.skip('does something', () => {/* ... */});
    }
    ```
  - Avoid conditional exports or dynamic `describe.skip`/`it.skip` based on config.

Correct approach:

- Ensure required preconditions are present for the environment where tests run (CI and local):
  - Document required env vars in .env.example and project docs.
- Provide Podman/Docker compose services to satisfy dependencies.
  - Seed or create required data within test setup; clean up after.
- If a required prerequisite is truly unavailable at runtime, let the test fail with a clear error message.
- If a test requires optional external integration (e.g., third-party API), either:
  - Mock it in unit tests; or
  - Provide a dedicated e2e job/profile where the prerequisite is guaranteed to exist. The test in that profile still must fail if the prerequisite is missing.

Enforcement tips:

- Prefer explicit assertions and setup checks that throw on missing config:
  ```ts
  const token = Cypress.env('GITHUB_PAT_TOKEN');
  expect(token, 'GITHUB_PAT_TOKEN must be set for this test').to.be.a('string').and.not.empty;
  ```
- Avoid `it.skip`, `describe.skip`, or early `return`/`this.skip()` conditioned on environment.

## Troubleshooting

### Common Issues

1. **E2E tests fail with connection error**
   - Ensure the server is running
   - Check if dependencies (PostgreSQL) are up
   - Verify the server is accessible at the expected URL

2. **Unit tests fail with module not found**
   - Run `pnpm install`
   - Check import paths
   - Ensure TypeScript is properly configured

3. **Tests are slow**
   - Check for hardcoded waits in E2E tests
   - Ensure database is properly seeded (not created fresh each test)
   - Consider parallelization for unit tests

