# Security Review Criteria

OWASP-aligned security analysis: injection attacks, authentication/authorization, secrets management, crypto, input validation, and data exposure — TypeScript, NestJS/Fastify, MikroORM, Keycloak, React 19.

## What to Check

### 1. Injection Vulnerabilities

- SQL injection: raw queries with string interpolation instead of parameterized MikroORM calls
- Command injection: shell execution (`exec`, `spawn`) with user-supplied input
- NoSQL/Qdrant injection: filter objects built from untrusted sources
- Template injection: dynamic template rendering with user content
- Docker sandbox escape: agent tools (`agent-tools/`) spawning shell commands without Docker sandbox wrapping
- Tool input injection: user-supplied tool inputs passed directly to Docker `exec` without escaping
- File operation tools allowing paths outside the workspace sandbox (path traversal via agent tools)

**How to detect:**
```bash
# MikroORM raw query with string interpolation
grep -n "em\.execute\|nativeQuery\|qb\.where" file.ts | grep '`\|+\s*[a-z]'
# Shell execution
grep -n "exec\|spawn\|execSync\|spawnSync" file.ts | grep -v "escape\|quote\|sanitize"
# Dynamic query builders
grep -n "createQueryBuilder\|knex\b" file.ts
# Shell execution in agent tool handlers
grep -rn "exec\b\|spawn\b\|execSync\b" apps/api/src/v1/agent-tools/ | grep -v "test\|spec"
# Path traversal in file-based agent tools
grep -n "join\|resolve\|readFile" apps/api/src/v1/agent-tools/ | grep "input\.\|param\.\|arg\."
```

**Red flags:**
- `` em.execute(`SELECT * FROM users WHERE id = ${userId}`) `` — interpolation in raw SQL
- `spawn('sh', ['-c', userInput])` — user input in shell command
- MikroORM `FilterQuery` built by spreading an untrusted request body
- `eval()` or `new Function(userInput)` anywhere in production code
- Agent tool handler using `exec(userSuppliedCommand)` without Docker sandbox wrapping
- File tool resolving paths relative to the host filesystem root instead of workspace root
- Tool returning environment variables or credential files in its text output

### 2. Authentication & Authorization

- Missing `@OnlyForAuthorized()` decorator on NestJS controllers handling user data
- Missing `@ApiBearerAuth()` on controllers requiring authentication (Swagger will not show auth field)
- Missing user-scoping: entity fetched by `id` without verifying it belongs to the current user from `AppContextStorage`
- Keycloak token not verified — dev-mode bypass (`AUTH_DEV_MODE=true`) present in non-dev builds
- RBAC gaps: role checks missing on admin-only or elevated endpoints
- API authentication bypasses through decorator misuse or missing guard registration
- Keycloak realm config modified from application code — realm management must be external only

**How to detect:**
```bash
# Controllers missing auth decorator
grep -n "@Controller\b" file.ts
grep -n "@OnlyForAuthorized\|@Public\b" file.ts
# Controllers missing Swagger auth tag
grep -n "@Controller\b" file.ts
grep -n "@ApiBearerAuth\b" file.ts
# Service methods fetching entity without user scope
grep -n "getOne\|findOne\b" file.ts | grep -v "ctx\.\|userId\|ownerId\|createdBy"
# Auth dev bypass outside env config
grep -rn "AUTH_DEV_MODE" apps/api/src/ | grep -v "environments\|\.env"
# Keycloak realm modification from app code
grep -rn "keycloak.*realm\|realm.*update\|realm.*create\|adminClient" apps/api/src/ | grep -v "test\|spec\|\.env"
```

**Red flags:**
- `@Controller('admin')` without `@OnlyForAuthorized()` or equivalent role guard
- `@Controller()` with `@OnlyForAuthorized()` but missing `@ApiBearerAuth()` — auth works but Swagger docs mislead consumers
- `this.graphDao.getOne({ id })` without `{ createdBy: ctx.userId }` scope — user A can read user B's data
- `AppContextStorage` bypassed by reading `req.user` directly without token verification
- Hardcoded user ID or token in service or DAO code
- Application code calling Keycloak Admin API to create/modify realms, clients, or roles

### 3. Secrets Management

- Hardcoded credentials, API keys, or tokens in source files
- Secrets logged via `DefaultLogger` or `console`
- Secrets returned in API responses (e.g., GitHub token included in a DTO)
- GitHub App private key (`GITHUB_APP_PRIVATE_KEY`), client secret (`GITHUB_APP_CLIENT_SECRET`), or PAT tokens logged or returned in responses
- Environment variables accessed via hardcoded string outside the `environments/` config module
- LLM API keys used directly instead of routing through LiteLLM proxy

**How to detect:**
```bash
# Hardcoded credential patterns
grep -in "password\s*=\s*['\"][^'\"\s]\|apiKey\s*=\s*['\"][^'\"\s]\|secret\s*=\s*['\"][^'\"\s]" file.ts | grep -v "process\.env\|config\."
# Secrets in logs
grep -n "logger\.\|console\." file.ts | grep -i "password\|token\|secret\|key\|credential"
# Sensitive fields in response objects
grep -n "token\|secret\|privateKey\|apiKey\|passwordHash" file.ts | grep "return\|dto\b\|response"
# GitHub tokens in logs or responses
grep -n "GITHUB_APP_PRIVATE_KEY\|GITHUB_APP_CLIENT_SECRET\|githubToken\|ghp_" file.ts | grep -v "process\.env\|config\."
# Direct LLM API calls bypassing LiteLLM proxy
grep -rn "openai\.com\|api\.anthropic\|api\.cohere\|generativelanguage\.googleapis" apps/api/src/ | grep -v "test\|spec\|litellm"
```

**Red flags:**
- `const token = "ghp_abc123"` — hardcoded GitHub PAT
- `logger.info('GitHub token', { token: this.githubToken })` — token in structured log
- `GITHUB_APP_PRIVATE_KEY` value committed in a non-env file
- DTO returning `{ ...entity }` where entity has sensitive columns
- Direct HTTP call to `https://api.openai.com/v1/chat/completions` — must go through LiteLLM proxy on port 4000
- LLM provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) used directly in application code instead of being configured only in LiteLLM

### 4. Cryptography

- Weak hashing algorithms (MD5, SHA1) for security-sensitive purposes
- `Math.random()` used for security tokens or session IDs
- Missing HMAC or authentication on encrypted data
- Outdated or broken cipher modes (ECB)

**How to detect:**
```bash
# Weak hashing
grep -in "md5\b\|sha1\b\|crc32" file.ts | grep -v "//\|description\|comment"
# Insecure random for security purposes
grep -n "Math\.random()" file.ts | grep -v "test\|mock\|seed\|color\|position"
# Legacy cipher APIs
grep -n "createCipher\b" file.ts
```

**Red flags:**
- `createHash('md5')` or `createHash('sha1')` for CSRF tokens, password hashes, or session IDs
- `Math.random()` generating tokens, nonces, or secrets
- ECB cipher mode usage
- No key rotation strategy for long-lived symmetric keys

### 5. Input Validation and Output Encoding

- Controller accepting `@Body()`, `@Query()`, or `@Param()` without a Zod DTO (`createZodDto`)
- Zod schema missing length/format constraints (`z.string()` with no `.min()` or `.max()`)
- Server-side validation absent — only frontend validation present
- `dangerouslySetInnerHTML` in React components with user-supplied content
- User input rendered in `href` or `src` attributes without protocol validation (`javascript:` scheme XSS)
- File upload or path parameters not normalized (path traversal risk)
- LLM prompt or Qdrant filter built directly from unvalidated user input

**How to detect:**
```bash
# Controller params without Zod DTO
grep -n "@Body()\s\|@Query()\s\|@Param()" file.ts | grep -v "Dto\b\|string\|number"
# z.string() without length/format constraints
grep -n "z\.string()" file.ts | grep -v "min\|max\|email\|uuid\|url\|regex\|trim"
# Dangerous HTML rendering in React
grep -n "dangerouslySetInnerHTML" file.tsx
# User input in href/src attributes
grep -n "href=\|src=" file.tsx | grep "{\|props\.\|data\.\|user"
# Path operations on user input
grep -n "readFile\|writeFile\|path\.join\|path\.resolve" file.ts | grep "req\.\|params\.\|body\.\|query\."
```

**Red flags:**
- `@Body() body: any` — no DTO, no Zod validation
- `z.object({ name: z.string() })` without `.min(1).max(200)` — allows empty or unbounded strings
- LLM prompt: `` `User request: ${userText}` `` injected into system prompt without sanitization
- `<div dangerouslySetInnerHTML={{ __html: message.content }} />` — XSS risk
- `<a href={userProvidedUrl}>` without validating protocol is `http:` or `https:` — `javascript:alert(1)` XSS
- `<img src={userInput} />` — attacker-controlled resource loading

### 6. Sensitive Data Exposure

- PII (email, phone, name) returned beyond what the requester needs (over-fetching)
- Stack traces or internal error details sent to API clients via NestJS exception filters
- Sensitive entity fields (`passwordHash`, `token`, `privateKey`) included in serialized response
- Error responses leaking DB table/column names or query structure
- Keycloak realm configuration details exposed through a public endpoint
- GitHub App installation tokens or OAuth credentials included in API responses

**How to detect:**
```bash
# Error details forwarded to client
grep -n "error\.message\|error\.stack\|error\.toString()" file.ts | grep "response\|res\.\|json(\|throw new.*Exception("
# Entity spread into response
grep -n "return.*entity\b\|return \{ \.\.\." file.ts
# Sensitive field names in response types/DTOs
grep -n "passwordHash\|apiToken\|privateKey\|secret\b" file.ts | grep "dto\b\|class\b\|interface\b\|return\b"
# Exception filters exposing internals
grep -rn "ExceptionFilter\|@Catch" apps/api/src/ | xargs grep -l "stack\|message\|query"
# GitHub token in API response shapes
grep -rn "installationToken\|accessToken\|githubToken" apps/api/src/v1/ | grep "dto\|return\|response"
```

**Red flags:**
- `throw new BadRequestException(error.message)` — exposes internal DB or library error to client
- Custom `ExceptionFilter` that forwards `error.stack` or raw `error.message` to the HTTP response body
- `return { ...entity }` where entity contains `passwordHash` or `apiToken` columns
- `logger.error('Query failed', { query, params })` — logs raw SQL with user data in params
- GitHub installation access token returned in a graph or repository DTO response

### 7. Security Headers and CORS Configuration

- Fastify/NestJS CORS configured with `origin: '*'` in non-development environments
- Missing CSRF protection on cookie-based auth flows
- Swagger UI enabled unconditionally without an environment guard
- `@fastify/helmet` or equivalent not registered on the Fastify instance

**How to detect:**
```bash
# Overly permissive CORS
grep -rn "origin.*['\*]['\|cors.*true\b" apps/api/src/ | grep -v "test\|spec\|dev\b"
# Swagger enabled without env guard
grep -n "SwaggerModule\|DocumentBuilder" apps/api/src/main.ts | grep -v "NODE_ENV\|process\.env"
# Helmet check
grep -n "helmet\|fastify-helmet\|@fastify/helmet" apps/api/src/main.ts
```

**Red flags:**
- `app.enableCors({ origin: '*' })` without checking `NODE_ENV !== 'production'`
- Swagger UI served on `/api/docs` with no environment gate
- `@fastify/helmet` not imported or registered in `main.ts`

### 8. Dependency Security

- Known vulnerabilities in pnpm packages
- Unpinned version ranges allowing silent upgrades to vulnerable versions
- Packages duplicating functionality already covered by existing dependencies
- Untrusted or abandoned packages added without review

**How to detect:**
```bash
# Audit dependencies
pnpm audit
# Check for new packages in recent commits
git diff HEAD~1 package.json | grep "^+"
# Check for duplicate-purpose packages
grep -n "axios\|node-fetch\|got\b" apps/web/package.json
```

**Red flags:**
- `pnpm audit` reports `high` or `critical` severity findings
- New `axios` added to a package that already uses the auto-generated API client (uses `fetch` internally)
- Version ranges using `*` or `latest`
- New package with no `pnpm-lock.yaml` update committed alongside it

## Output Format

```json
{
  "type": "security",
  "severity": "critical|high|medium",
  "title": "Brief vulnerability title",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Detailed description of security risk",
  "code_snippet": "Vulnerable code",
  "vulnerability_type": "injection|auth|secrets|crypto|validation|exposure|headers|dependencies",
  "owasp_category": "A01|A02|A03|A04|A05|A06|A07|A08|A09|A10",
  "impact": "What an attacker can do with this vulnerability",
  "recommendation": "How to fix it securely",
  "confidence": 90
}
```

## Common False Positives

1. **Legitimate string building** — Not all string concatenation is injection
   - Check if values come from trusted internal sources (enum constants, config), not user input
   - MikroORM `qb.where` with enum literals is safe

2. **Test or development code** — Security may be relaxed in test context
   - Verify the file is under a `test`/`spec`/`__tests__` directory, not production
   - `AUTH_DEV_MODE=true` is acceptable in `.env.local`, not in production config

3. **Configuration-driven CORS** — Allowlist may be injected at runtime
   - Check if origin is loaded from `process.env.CORS_ORIGIN` rather than hardcoded `'*'`

4. **Intentionally public endpoints** — Some endpoints are meant to be unauthenticated
   - `GET /api/system/settings` returning `githubAppEnabled` is intentionally public
   - Check controller comments or API documentation

5. **Framework defaults** — NestJS and Fastify provide security mechanisms by default
   - `nestjs-zod` Zod DTOs automatically strip unknown fields
   - Do not flag if the framework's recommended Zod/DTO pattern is applied correctly

6. **Defense in depth** — Multiple validation layers are not redundant
   - Both frontend Zod validation and backend Zod DTO are correct — do not flag as duplicate effort

7. **LiteLLM configuration files** — LiteLLM config referencing provider API URLs is expected
   - The proxy itself needs provider URLs — only flag direct calls from application source code in `apps/` or `packages/`

8. **Docker API calls in runtime module** — The `runtime` module legitimately uses Dockerode
   - Only flag shell execution or Docker calls in `agent-tools/` that bypass the sandbox abstraction

## Review Checklist

- [ ] No raw SQL with string interpolation — MikroORM `FilterQuery` or parameterized queries only
- [ ] All controllers have `@OnlyForAuthorized()` and `@ApiBearerAuth()` unless intentionally public
- [ ] All entity fetches scoped to current user from `AppContextStorage`
- [ ] No hardcoded credentials, tokens, or API keys in source
- [ ] No secrets logged or returned in responses or error messages
- [ ] GitHub tokens and App credentials never logged or included in API responses
- [ ] All `@Body()`, `@Query()`, `@Param()` use Zod DTOs with length/format constraints
- [ ] No `dangerouslySetInnerHTML` with user-supplied content in React
- [ ] No user-controlled values in `href`/`src` attributes without protocol validation
- [ ] CORS not set to `'*'` in non-development builds
- [ ] `pnpm audit` passes without high/critical findings
- [ ] Agent tools execute inside Docker sandbox, not directly on the host
- [ ] All LLM calls route through LiteLLM proxy — no direct provider API calls from application code
- [ ] Keycloak realm configuration managed externally — no realm modification from application code
- [ ] NestJS exception filters do not expose stack traces or internal error details to clients
- [ ] Swagger disabled or gated behind `NODE_ENV` check in production

## Severity Guidelines

- **CRITICAL**: SQL/command injection, hardcoded credentials, auth bypass, RCE via agent tool sandbox escape, direct LLM provider API calls leaking keys
- **HIGH**: Missing `@OnlyForAuthorized()`, user data cross-access (IDOR), weak crypto, secrets in logs/responses, GitHub tokens exposed in API responses, Keycloak realm modification from app code
- **MEDIUM**: Missing input length constraints, CORS misconfiguration, Swagger exposed in production, missing Helmet headers, `dangerouslySetInnerHTML` with semi-trusted content, user input in `href`/`src` without protocol check
