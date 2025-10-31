# Testing Guidelines

This document explains how to run and write tests for the Ai company API project.

## Overview

The project uses two testing frameworks:
- **Vitest** for unit tests
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

- Run unit tests with coverage:
  ```bash
  pnpm test:cov
  ```

- Run tests for packages only:
  ```bash
  pnpm test:packages
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

Example unit test:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './users.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    // Setup
    service = new UserService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a user', async () => {
    const userData = { email: 'test@example.com', name: 'Test User' };
    const result = await service.create(userData);
    
    expect(result).toBeDefined();
    expect(result.email).toBe(userData.email);
  });
});
```

### Prefer Updating Existing Test Files

When adding new tests for a feature/module/API that already has test coverage:

- Prefer updating the existing test file and add new test cases to the appropriate describe block instead of creating a new file.
- Only create a new test file when the scope is clearly different (e.g., a new feature area, different module, or the existing file has become too large and logically split by domain).
- Benefits: avoids duplication, keeps related scenarios together, simplifies maintenance and discovery.

Examples:
- Unit tests: if src/v1/users/users.service.spec.ts exists and you add more service methods, add new `describe/it` blocks there rather than creating another users.service.more.spec.ts.
- E2E tests: if apps/api/cypress/e2e/users/users.cy.ts exists and you add new user flows, extend that file (or its existing suites) instead of creating users-new.cy.ts.

## E2E Testing

### Running E2E Tests

The project uses Cypress for E2E testing.

**Important**: Before running E2E tests, ensure the server is running and dependencies are up.

#### Complete E2E Test Workflow

1. **Start dependencies (PostgreSQL)**:
   ```bash
   docker-compose up -d
   # or
   pnpm deps:up
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
   # From project root
   pnpm test:e2e
   
   # Or from apps/api
   cd apps/api
   pnpm test:e2e:local
   ```

#### E2E Test Commands

- Run all E2E tests:
  ```bash
  pnpm test:e2e
  ```

- Run E2E tests against a local server:
  ```bash
  pnpm test:e2e:local
  ```

- Generate API definitions from Swagger:
  ```bash
  cd apps/api
  pnpm test:e2e:generate-api
  ```

**Important**: Before running E2E tests or generating API definitions, you should run the command to generate API definitions:
```bash
cd apps/api
pnpm test:e2e:generate-api
```

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

Example E2E test:
```typescript
import { createUser, deleteUser } from './users.helper';

describe('Users API', () => {
  it('should create a new user', () => {
    const userData = {
      email: 'test@example.com',
      name: 'Test User',
    };

    createUser(userData).then((response) => {
      expect(response.status).to.eq(201);
      expect(response.body).to.have.property('id');
      expect(response.body.email).to.eq(userData.email);
    });
  });

  it('should get user by id', () => {
    // Test implementation
  });
});
```

## Test Coverage

### Checking Coverage

```bash
pnpm test:cov
```

This generates a coverage report in the `coverage/` directory.

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

