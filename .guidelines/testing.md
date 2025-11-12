# Testing Guidelines

This document explains how to run and write tests for the Ai company API project.

## Overview

The project uses two testing frameworks:
- **Vitest** for unit tests and integration tests
- **Cypress** for E2E (end-to-end) tests

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

The project uses Vitest for unit testing:

- Run all unit tests:
  ```bash
  pnpm test
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

```bash
# Run all tests (unit + integration)
pnpm test

# Run only unit tests (excluding integration tests)
pnpm test:unit

# Run only integration tests (excluding unit tests)
pnpm test:integration

# Run with coverage
pnpm test:cov

# Run specific integration test file
pnpm vitest src/__tests__/integration/graphs/graph-lifecycle.int.ts

# Run integration tests in watch mode
pnpm vitest --watch src/__tests__/integration/
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
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import { AppModule } from '../../../app.module';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { AuthContextService } from '@packages/http-server';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

describe('Graph Lifecycle Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthContextService)
      .useValue({
        checkSub: () => TEST_USER_ID,
        getSub: () => TEST_USER_ID,
        getOrganizationId: () => TEST_ORG_ID,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    graphsService = moduleRef.get<GraphsService>(GraphsService);
  });

  afterEach(async () => {
    // Cleanup created resources
    for (const graphId of createdGraphIds) {
      try {
        await graphsService.destroy(graphId);
        await graphsService.delete(graphId);
      } catch {
        // Resource might already be deleted
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create and run a graph', async () => {
    const graphData = createMockGraphData();

    const result = await graphsService.create(graphData);
    createdGraphIds.push(result.id);

    expect(result.status).toBe('created');

    const runResult = await graphsService.run(result.id);
    expect(runResult.status).toBe('running');
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
   # if using docker
   docker-compose up -d
   # or
   pnpm run deps:up
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
   # wait-until-healthy helper (times out after ~30s)
   until [ "$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health/check)" = "200" ]; do
     echo "Waiting for API to be ready..."; sleep 2; done
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
  You can replace the path with any spec you’re working on. Extra args after `--` are forwarded to Cypress.

- List available spec files:
  ```bash
  cd apps/api
  find cypress/e2e -type f \( -name "*.cy.ts" -o -name "*.cy.js" \) | sort
  ```

- Run all specs sequentially, stopping on first failure (Bash/Zsh):
  ```bash
  cd apps/api
  find cypress/e2e -type f \( -name "*.cy.ts" -o -name "*.cy.js" \) | sort | \
  while IFS= read -r spec; do
    echo "Running $spec"
    pnpm test:e2e:local --spec "$spec" || { echo "Failed: $spec"; break; }
  done
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

### E2E Tests

- **Test user flows**: Simulate real user interactions
- **Use realistic data**: Test with data similar to production
- **Clean up after tests**: Delete test data created during tests
- **Independent tests**: Each test should be able to run independently
- **Avoid hardcoded waits**: Use Cypress commands that wait for elements

### Integration Tests

- **Test real scenarios**: Focus on actual use cases and workflows, not isolated units
- **Direct service calls**: Use services directly rather than HTTP requests
- **Clean up resources**: Always clean up created resources to avoid test pollution
- **Test state transitions**: Verify complex state changes and async operations
- **Edge cases and business logic**: Go deep into all aspects of business logic
- **Independent tests**: Each test should be able to run independently

### General

- **Keep tests fast**: Unit tests should run in milliseconds
- **Maintain tests**: Update tests when code changes
- **Fix failing tests immediately**: Don't ignore or skip failing tests
- **Use descriptive assertions**: Make it clear what is expected

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
  - Provide docker-compose/services to satisfy dependencies.
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

