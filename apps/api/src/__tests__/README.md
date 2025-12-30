# Integration Tests

This directory contains integration tests for the API using Vitest.

## Overview

> **Important (Agent environment)**: Integration tests are **not required** and are currently **not implemented/maintained for the agent environment**.
>
> The mandatory quality gate for day-to-day development is `pnpm run full-check` from repo root, which runs **unit tests**.

Integration tests verify the interaction between different parts of the system by calling services directly without HTTP requests. This approach provides:

- **Faster execution** - Direct service calls are faster than HTTP requests
- **Better debugging** - Direct access to service methods and their responses
- **Type safety** - Full TypeScript support throughout the test chain
- **Isolation** - Each test file has its own test application context

## Structure

```
src/__tests__/
├── integration/
│   ├── helpers/
│   │   └── graph-helpers.ts     # Helper utilities for test data creation
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

## Writing Integration Tests

### Basic Structure

```typescript
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import { AppModule } from '../../../app.module';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { AuthContextService } from '@packages/http-server';
import { createMockGraphData } from '../helpers/graph-helpers';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

describe('My Feature Integration Tests', () => {
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
      } catch {
        // Resource might not be running
      }
      try {
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

  it('should perform some action', async () => {
    const graphData = createMockGraphData();
    
    // Use service directly
    const result = await graphsService.create(graphData);
    createdGraphIds.push(result.id);
    
    expect(result.status).toBe('created');
  });
});
```

### Key Principles

1. **Setup Test App in Each File**: Each test file sets up its own `TestingModule` and `NestApplication` instance
2. **Get Services from Module**: Get service instances directly from the test module using `moduleRef.get<ServiceType>(ServiceClass)`
3. **Use Direct Service Calls**: Call service methods directly instead of making HTTP requests
4. **No Helper Functions**: Use services inline in tests rather than creating wrapper functions
5. **Use Existing Types**: Use DTOs and types from the codebase instead of creating custom interfaces
6. **Cleanup Resources**: Always clean up created resources in `afterEach` or `afterAll`
7. **Override Auth Context**: Override `AuthContextService` to provide test user credentials

### Getting Multiple Services

```typescript
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

  // Get multiple services
  graphsService = moduleRef.get<GraphsService>(GraphsService);
  threadsService = moduleRef.get<ThreadsService>(ThreadsService);
  revisionsService = moduleRef.get<GraphRevisionService>(GraphRevisionService);
});
```

## Running Tests

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

## Integration vs E2E Tests

### Overview

The project uses two types of tests with distinct purposes:

**E2E Tests (Cypress)** - `cypress/e2e/*.cy.ts`
- Test basic endpoint functionality and reachability
- Verify HTTP request/response flows
- Check basic validation and error handling
- Test that endpoints are accessible and return expected status codes
- **Purpose**: Smoke testing to ensure general functionality works

**Integration Tests (Vitest)** - `src/__tests__/integration/*.int.ts`
- Deep dive into business logic and edge cases
- Test complex workflows and state transitions
- Verify detailed behavior of services and their interactions
- Test asynchronous operations and side effects
- **Purpose**: Comprehensive testing of all aspects of business logic

### Detailed Comparison

| Aspect | Integration Tests (Vitest) | E2E Tests (Cypress) |
|--------|---------------------------|---------------------|
| **Location** | `src/__tests__/integration/` | `cypress/e2e/` |
| **Purpose** | Detailed business logic testing | Basic endpoint validation |
| **Execution** | Direct service calls | HTTP requests |
| **Speed** | Fast | Slower |
| **Coverage** | Comprehensive scenarios, edge cases, state transitions | Smoke tests, endpoint reachability, basic validation |
| **When to use** | Complex workflows, business logic validation, async operations | Verify endpoints work, basic CRUD operations, general validation |
| **Example** | Testing revision status transitions through multiple states | Testing that POST /graphs returns 201 and validates required fields |

## Examples

### Creating and Updating a Graph

```typescript
it('should update graph schema', async () => {
  const graphData = createMockGraphData();
  
  const createResult = await graphsService.create(graphData);
  createdGraphIds.push(createResult.id);
  
  const updatedSchema = {
    ...createResult.schema,
    nodes: createResult.schema.nodes.map((node: unknown) =>
      (node as { id: string }).id === 'agent-1'
        ? {
            ...(node as object),
            config: {
              ...((node as { config: object }).config),
              instructions: 'Updated instructions',
            },
          }
        : node,
    ),
  };
  
  const updateResult = await graphsService.update(createResult.id, {
    schema: updatedSchema,
    currentVersion: createResult.version,
  });
  
  expect(updateResult.version).not.toBe(createResult.version);
});
```

### Testing Error Handling

```typescript
it('should throw error for invalid data', async () => {
  const invalidData = createMockGraphData({
    schema: {
      nodes: [
        {
          id: 'node-1',
          template: 'invalid-template',
          config: {},
        },
      ],
      edges: [],
    },
  });
  
  await expect(graphsService.create(invalidData)).rejects.toThrow(
    "Template 'invalid-template' is not registered"
  );
});
```

### Testing WebSocket Notifications

```typescript
it('should receive notification', async () => {
  const socket = io(baseUrl, { 
    auth: { token: TEST_USER_ID },
    transports: ['websocket'],
  });
  
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Timeout')), 5000);
  });
  
  const notificationPromise = new Promise((resolve, reject) => {
    socket.once('event.name', resolve);
    socket.once('server_error', reject);
    setTimeout(() => reject(new Error('Timeout')), 5000);
  });
  
  // Trigger action
  await graphsService.performAction(resourceId);
  
  // Wait for notification
  await notificationPromise;
  
  socket.disconnect();
});
```

## Best Practices

1. **Test Real Scenarios**: Focus on actual use cases and workflows
2. **Cleanup**: Always clean up resources to avoid test pollution
3. **Assertions**: Use meaningful assertions that test the actual behavior
4. **Async/Await**: Always use async/await for asynchronous operations
5. **Error Testing**: Test both success and error cases
6. **Isolation**: Each test should be independent and not rely on other tests
7. **Setup Once**: Set up the test app once per file in `beforeAll`, not in each test

## Common Patterns

### Waiting for Asynchronous Operations

```typescript
it('should apply revision after graph update', async () => {
  // Perform action
  await graphsService.update(graphId, updateData);
  
  // Wait for async operation
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Verify result
  const revisions = await revisionsService.getRevisions(graphId);
  expect(revisions.length).toBeGreaterThan(0);
});
```

### Polling for Status Changes

```typescript
it('should track status transitions', async () => {
  await graphsService.update(graphId, updateData);
  
  const maxAttempts = 20;
  let attempts = 0;
  let currentStatus = 'created';
  const statusHistory: string[] = [currentStatus];
  
  while (attempts < maxAttempts && currentStatus !== 'applied') {
    await new Promise(resolve => setTimeout(resolve, 500));
    const revision = await revisionsService.getRevisionById(revisionId);
    if (revision.status !== currentStatus) {
      currentStatus = revision.status;
      statusHistory.push(currentStatus);
    }
    attempts++;
  }
  
  expect(statusHistory).toContain('applied');
});
```

## Troubleshooting

### Tests Fail with Database Errors

Integration tests require a running database. Make sure you have:
- PostgreSQL running
- Environment variables configured
- Migrations applied

### Tests Are Slow

If tests are taking too long:
- Check for proper cleanup in `afterEach`
- Avoid unnecessary waits
- Use direct service calls instead of polling

### Type Errors with Unknown

When working with unknown types from the database:
- Use type assertions: `(node as { id: string }).id`
- Use existing DTOs from the codebase
- Don't create custom interfaces

### Memory Leaks

If you see memory leaks:
- Ensure `app.close()` is called in `afterAll`
- Disconnect all sockets in `afterEach`
- Clean up all resources (graphs, threads, etc.)

## Contributing

When adding new integration tests:

1. Place them in the appropriate directory (`graphs/`, `threads/`, etc.)
2. Follow the naming convention: `*.int.ts`
3. Set up your own `TestingModule` and `NestApplication` in `beforeAll`
4. Get services using `moduleRef.get<ServiceType>(ServiceClass)`
5. Add cleanup logic in `afterEach`
6. Run linting: `pnpm lint`
7. Ensure tests pass: `pnpm test:integration`

## Test Coverage

The integration tests provide comprehensive coverage of:

### Graphs
- **Lifecycle**: Create, update, run, destroy, delete
- **Version Management**: Schema updates, version conflicts
- **Constraints**: Validation of running state transitions
- **Validation**: Schema validation, template validation, edge validation

### Graph Revisions
- **Creation**: Revision creation on schema updates
- **Application**: Revision status tracking and application
- **Multiple Revisions**: Sequential revision handling
- **Retrieval**: Get revisions by graph ID or revision ID

### Threads
- **Creation and Isolation**: Thread creation with/without threadSubId
- **Retrieval**: Get threads by ID, by graph, etc.
- **Async Execution**: Async trigger execution

### Socket Notifications
- **Connection**: Valid/invalid token handling
- **Subscription**: Graph subscription and unsubscription
- **Messages**: Message notifications and duplicate prevention
- **Revisions**: Revision lifecycle notifications
- **Node Status**: Node status update notifications
- **Threads**: Thread creation and state update notifications
- **Multiple Clients**: Broadcasting to multiple connections
