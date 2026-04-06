---
globs:
  - "apps/api/src/**/*.ts"
  - "apps/web/src/**/*.ts"
  - "apps/web/src/**/*.tsx"
  - "packages/**/*.ts"
  - "*.{yml,yaml,json,xml,conf,config}"
  - "docker*"
  - "!**/*.test.*"
  - "!**/*.spec.*"
  - "!**/node_modules/**"
---

# Security Patterns

## Input Validation

**Pattern**: Use Zod DTOs at API boundaries; never trust client-side validation

```typescript
// GOOD — Zod schema validates at controller boundary
export const CreateGraphSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
});
export class CreateGraphDto extends createZodDto(CreateGraphSchema) {}

// BAD — No validation
function processUserInput(input: string): void {
  const query = `SELECT * FROM users WHERE name = '${input}'`; // SQL injection!
}
```

## SQL Injection Prevention

**Pattern**: Always use MikroORM EntityManager or parameterized queries; never concatenate user input

```typescript
// GOOD — Using MikroORM
const user = await em.findOne(UserEntity, { id: userId, status: 'active' });

// GOOD — Parameterized raw query
const result = await em.execute(
  'SELECT * FROM users WHERE id = $1 AND status = $2',
  [userId, 'active']
);

// BAD — String concatenation
const user = await em.execute(`SELECT * FROM users WHERE id = ${userId}`);
```

## Authentication & Authorization

**Pattern**: Use Keycloak decorators and `AppContextStorage` for auth; never bypass auth checks

```typescript
// GOOD — NestJS decorators enforce auth
@Controller('graphs')
@ApiBearerAuth()
@OnlyForAuthorized()
export class GraphsController {
  @Get(':id')
  async getGraph(
    @Param() { id }: EntityUUIDDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<GraphDto> {
    return await this.graphsService.getById(ctx, id);
  }
}

// BAD — No auth decorator
@Controller('admin')
export class AdminController {
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    await this.userService.delete(id); // Anyone can delete!
  }
}
```

## Cross-Site Scripting (XSS) Prevention

**Pattern**: React auto-escapes by default; avoid `dangerouslySetInnerHTML`

```typescript
// GOOD — React auto-escapes
return <div>{userComment}</div>;

// BAD — Direct HTML injection
return <div dangerouslySetInnerHTML={{ __html: userInput }} />;
```

## Secrets Management

**Pattern**: Never hardcode secrets; use environment variables

```typescript
// GOOD — Environment variables
const config = {
  dbUrl: process.env.DATABASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY,
  jwtSecret: process.env.JWT_SECRET,
};

// BAD — Hardcoded secrets
const dbPassword = "super_secret_password_123";
const apiKey = "sk_live_abc123xyz";
```

## Cryptography

**Pattern**: Use strong algorithms; never use MD5 or SHA1 for security

```typescript
// GOOD — Strong hashing
import { createHash } from 'crypto';
const hash = createHash('sha256').update(data).digest('hex');

// BAD — Weak hashing
const hash = createHash('md5').update(data).digest('hex');

// BAD — Math.random for security tokens
const token = Math.random().toString(36);
```

## Data Exposure Prevention

**Pattern**: Minimize logging of sensitive data; redact passwords, tokens, and PII

```typescript
// GOOD — Redacting sensitive data
logger.info('User login attempt', { userId: user.id });

// BAD — Logging sensitive data
logger.info('Login', { userId: user.id, password: password });

// BAD — Exposing internals to client
res.status(500).json({ error: error.toString(), stack: error.stack });
```

## Rate Limiting

**Pattern**: Use NestJS Throttler for rate limiting on sensitive endpoints

```typescript
// GOOD — Throttle decorator
import { Throttle } from '@nestjs/throttler';

@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('login')
async login(@Body() dto: LoginDto) { }
```

## Dependency Security

**Pattern**: Regularly audit dependencies

```bash
# Check for vulnerabilities
pnpm audit

# Update dependencies
pnpm up-versions
```

## Domain-Specific Security Rules

- **Agent tool execution**: Tools run inside Docker containers with resource limits — never allow tools to escape the sandbox
- **LLM proxy**: All model calls route through LiteLLM proxy (port 4000) — never call LLM providers directly from application code
- **Keycloak realm**: Auth configuration is managed externally — never modify Keycloak realm settings from application code
- **GitHub tokens**: GitHub PAT tokens and App credentials are sensitive — never log or expose them in API responses
