# Testing Guidelines

This document explains how to run and write tests for the Ai company API project.

## Overview

The project uses two testing frameworks:
- **Vitest** for unit tests
- **Cypress** for E2E (end-to-end) tests

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

2. **Start the server in background**:
   ```bash
   cd apps/api
   pnpm start:dev &
   # or in a separate terminal:
   pnpm start:dev
   ```

3. **Wait for server to be ready** (check http://localhost:3000/health)

4. **Run E2E tests**:
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

