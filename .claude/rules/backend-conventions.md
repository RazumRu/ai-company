---
globs:
  - "apps/api/src/**/*.ts"
  - "packages/**/*.ts"
  - "!**/*.test.ts"
  - "!**/*.spec.ts"
  - "!**/*.int.ts"
---

# Backend Conventions

## Naming Conventions

### Functions and Methods

**Pattern**: Use camelCase for functions/variables, PascalCase for classes/interfaces/enums/types

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

**Pattern**: Throw custom exceptions from `@packages/common`; never swallow errors silently

```typescript
// GOOD — using project custom exceptions
import { NotFoundException, BadRequestException } from '@packages/common';

async function getGraph(id: string): Promise<GraphEntity> {
  const graph = await this.graphDao.findOne(id);
  if (!graph) {
    throw new NotFoundException(`Graph ${id} not found`);
  }
  return graph;
}

// BAD — swallowing error
try {
  const graph = await this.graphDao.findOne(id);
} catch (error) {
  console.log(error); // Never use console.log in production
}
```

## Async/Await

**Pattern**: Always `return await` async calls (not bare `return somePromise()`) for proper stack traces

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

**Pattern**: Use structured Pino logging via `@packages/common`; appropriate log levels

```typescript
// GOOD
logger.info(`User login successful`, { userId, timestamp: new Date() });
logger.warn(`Retry attempt ${attempt}/${maxRetries} for operation ${opId}`);
logger.error(`Database connection failed`, { code, message: error.message });

// BAD
console.log("User login successful");
console.error(error);
```

## Database Access

**Pattern**: Use MikroORM `EntityManager` with `FilterQuery<T>` for type-safe queries; never concatenate user input

```typescript
// GOOD — using MikroORM DAO pattern
async findAll(filter: FilterQuery<GraphEntity>): Promise<GraphEntity[]> {
  return await this.em.find(GraphEntity, filter);
}

// GOOD — using FilterQuery for flexible queries
async findByStatus(status: GraphStatus): Promise<GraphEntity[]> {
  return await this.em.find(GraphEntity, { status });
}

// BAD — string concatenation
const graphs = await this.em.getConnection().execute(`SELECT * FROM graphs WHERE id = ${id}`);
```

## Configuration Management

**Pattern**: Load config from environment variables via `apps/api/src/environments/`; never hardcode secrets

```typescript
// GOOD
const config = {
  dbUrl: process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  port: parseInt(process.env.PORT || "5000", 10),
};

// BAD
const dbUrl = "postgresql://user:pass@localhost/db";
```

## Testing

**Pattern**: Unit tests (`*.spec.ts`) next to source; integration tests (`*.int.ts`) in `src/__tests__/integration/`

```typescript
// GOOD — unit test
describe("GraphService", () => {
  it("should return graph when found", async () => {
    const graph = await graphService.findOne("123");
    expect(graph.id).toBe("123");
  });

  it("should throw NotFoundException when not found", async () => {
    await expect(graphService.findOne("nonexistent")).rejects.toThrow(NotFoundException);
  });
});
```

## Type Safety

**Pattern**: Never use `any`; use specific types, generics, or `unknown` + type guards

```typescript
// GOOD — Zod-backed DTO
const CreateGraphSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
class CreateGraphDto extends createZodDto(CreateGraphSchema) {}

// BAD
function processGraph(graph: any): void { }
```

## NestJS Module Structure

**Pattern**: Each feature follows Controller → Service → DAO → Entity layering

```typescript
// Controller — thin, route + validate only
@Controller('v1/graphs')
export class GraphsController {
  constructor(private readonly graphsService: GraphsService) {}
}

// Service — business logic, orchestrates DAOs
@Injectable()
export class GraphsService {
  constructor(private readonly graphsDao: GraphsDao) {}
}

// DAO — database queries via EntityManager
@Injectable()
export class GraphsDao {
  constructor(private readonly em: EntityManager) {}
}
```
