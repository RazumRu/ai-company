---
globs:
  - "apps/api/src/**/*.ts"
  - "packages/**/*.ts"
  - "!**/*.spec.ts"
  - "!**/*.int.ts"
  - "!**/*.cy.ts"
---

# Backend Conventions

## Naming Conventions

### Functions and Methods

**Pattern**: Use camelCase for variables/functions, PascalCase for classes/interfaces/enums/types

```typescript
// GOOD
function getUserById(userId: string): User { }
const calculateTotal = (items: Item[]): number => { }

// BAD
function get_user_by_id(userId: string): User { }
```

### Variables

**Pattern**: Use descriptive names; avoid single-letter variables except in loops

```typescript
// GOOD
const maxRetries = 3;
const userCache = new Map();
for (let i = 0; i < items.length; i++) { }

// BAD
const m = 3;
const c = new Map();
```

### Constants

**Pattern**: Use UPPER_SNAKE_CASE for constants

```typescript
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const API_VERSION = "v2";
```

## Error Handling

**Pattern**: Always handle errors explicitly; use custom exceptions from `@packages/common`

```typescript
// GOOD
import { NotFoundException, BadRequestException } from '@packages/common';

if (!entity) {
  throw new NotFoundException(`Graph ${id} not found`);
}

// BAD — never swallow errors silently
try {
  const user = await getUserById(id);
} catch (error) {
  console.log(error);
}
```

## Async/Await

**Pattern**: Always `return await` async calls — not bare `return somePromise()`

```typescript
// GOOD
async function fetchUserData(userId: string): Promise<UserData> {
  const user = await getUser(userId);
  const profile = await getProfile(user.profileId);
  return { user, profile };
}

// BAD — bare return loses stack trace
async function fetchUserData(userId: string): Promise<UserData> {
  return getUser(userId);
}
```

## Logging

**Pattern**: Use structured Pino logging from `@packages/common` (`DefaultLogger`)

```typescript
// GOOD
import { DefaultLogger } from '@packages/common';
const logger = new DefaultLogger('MyService');

logger.info(`User login successful`, { userId });
logger.warn(`Retry attempt ${attempt}/${maxRetries}`);
logger.error(`Database connection failed`, { code, message: error.message });

// BAD
console.log("User login successful");
console.error(error);
```

## Database Access

**Pattern**: Use MikroORM EntityManager via DAOs extending BaseDao; use `FilterQuery<T>` for type-safe filtering

```typescript
// GOOD — DAO pattern with BaseDao
@Injectable()
export class GraphDao extends BaseDao<GraphEntity> {
  constructor(em: EntityManager) {
    super(em, GraphEntity);
  }
}

// GOOD — service uses DAO
const graph = await this.graphDao.getOne({ id: graphId });
const graphs = await this.graphDao.getAll({ status: GraphStatus.ACTIVE });

// BAD — raw query with string concatenation
const users = await em.execute(`SELECT * FROM users WHERE id = ${userId}`);
```

## DTOs & Validation

**Pattern**: Use Zod schemas with `createZodDto()`. Keep all DTOs for a module in a single file.

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateGraphSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export class CreateGraphDto extends createZodDto(CreateGraphSchema) {}
```

## Configuration Management

**Pattern**: Load config from environment variables; never hardcode secrets

```typescript
// GOOD
const config = {
  dbUrl: process.env.DATABASE_URL,
  port: parseInt(process.env.PORT || "5000", 10),
};

// BAD
const dbUrl = "postgresql://user:pass@localhost/db";
```

## Testing

**Pattern**: Unit tests (*.spec.ts) next to source, integration tests (*.int.ts) in `src/__tests__/integration/`

```typescript
// Unit test pattern
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GraphsService', () => {
  let service: GraphsService;
  let graphDao: Pick<GraphDao, 'getOne' | 'getAll'>;

  beforeEach(() => {
    graphDao = { getOne: vi.fn(), getAll: vi.fn() };
    service = new GraphsService(graphDao as any);
  });

  it('should return graph when found', async () => {
    vi.mocked(graphDao.getOne).mockResolvedValue(mockGraph);
    const result = await service.getById('123');
    expect(result.id).toBe('123');
  });
});
```

## Type Safety

**Pattern**: No `any` — use specific types, generics, or `unknown` + type guards

```typescript
// GOOD
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

function processUser(user: User): void { }

// BAD
function processUser(user: any): void { }
```
