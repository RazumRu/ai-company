---
globs:
  - "apps/api/src/**/*.ts"
  - "packages/**/*.ts"
  - "apps/web/src/**/*.{ts,tsx}"
  - "*.{yml,yaml,json}"
  - "docker*"
  - "!**/*.test.*"
  - "!**/*.spec.*"
  - "!**/node_modules/**"
---

# Security Patterns

## Input Validation

**Pattern**: Use Zod schemas for all input validation; never trust client-side validation

```typescript
// GOOD — Zod-backed DTO validation
const CreateGraphSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  templateId: z.string().uuid(),
});
class CreateGraphDto extends createZodDto(CreateGraphSchema) {}

// BAD — No validation
function processUserInput(input: string): void {
  const query = `SELECT * FROM users WHERE name = '${input}'`; // SQL injection!
}
```

## SQL Injection Prevention

**Pattern**: Use MikroORM queries with `FilterQuery<T>`; never concatenate user input into SQL

```typescript
// GOOD — Using MikroORM
const user = await this.em.findOne(UserEntity, { id: userId, status: 'active' });

// GOOD — Parameterized raw query (when needed)
const result = await this.em.getConnection().execute(
  "SELECT * FROM users WHERE id = $1 AND status = $2",
  [userId, "active"]
);

// BAD — String concatenation
const user = await this.em.getConnection().execute(`SELECT * FROM users WHERE id = ${userId}`);
```

## Authentication & Authorization

**Pattern**: Use Keycloak via `AuthContextService`; verify permissions on every sensitive operation

```typescript
// GOOD — Auth guard + context
@UseGuards(AuthGuard)
@Get(':id')
async getGraph(@Param('id') id: string): Promise<GraphEntity> {
  const userId = this.authContextService.getCurrentUserId();
  return await this.graphsService.findOneForUser(id, userId);
}

// BAD — No auth check
@Get(':id')
async getGraph(@Param('id') id: string): Promise<GraphEntity> {
  return await this.graphsService.findOne(id); // Anyone can access!
}
```

## Cross-Site Scripting (XSS) Prevention

**Pattern**: Sanitize user-controlled content; React auto-escapes by default but watch for `dangerouslySetInnerHTML`

```typescript
// GOOD — React auto-escapes
return <div>{userComment}</div>;

// BAD — Direct HTML injection
return <div dangerouslySetInnerHTML={{ __html: userInput }} />; // XSS!
```

## Secrets Management

**Pattern**: Never hardcode secrets; use environment variables loaded via `apps/api/src/environments/`

```typescript
// GOOD — Environment variables
const config = {
  dbUrl: process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  jwtSecret: process.env.JWT_SECRET,
};

// BAD — Hardcoded secrets
const dbPassword = "super_secret_password_123";
const apiKey = "sk_live_abc123xyz";
```

## Dependency Security

**Pattern**: Regularly audit dependencies

```bash
pnpm audit
pnpm audit --fix
```

## Data Exposure Prevention

**Pattern**: Use Pino structured logging; redact passwords, tokens, and PII

```typescript
// GOOD — Redacting sensitive data
logger.info("User login attempt", { userId: user.id, timestamp: new Date() });

// BAD — Logging sensitive data
logger.info("Login", { userId: user.id, password: password });

// BAD — Exposing internals to client
res.status(500).json({ error: error.toString() });
```

## Rate Limiting

**Pattern**: Use `@nestjs/throttler` on authentication and sensitive endpoints

```typescript
// GOOD — NestJS Throttler
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 5, ttl: 900000 } })
@Post('login')
async login(@Body() dto: LoginDto): Promise<TokenResponse> {
  return await this.authService.login(dto);
}
```

## HTTPS/TLS

**Pattern**: Always use HTTPS in production; enforce HSTS headers

```typescript
// GOOD — HSTS via Fastify
app.register(helmet, {
  hsts: { maxAge: 31536000, includeSubDomains: true },
});
```
