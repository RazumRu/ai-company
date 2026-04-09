# Security Review Criteria

OWASP-aligned security analysis: injection attacks, authentication/authorization, secrets management, crypto, input validation, and data exposure.

## What to Check

### 1. Injection Vulnerabilities
- SQL injection: raw queries with string concatenation instead of MikroORM/parameterized queries
- Command injection: shell execution with user input (especially in agent-tools, runtime module)
- Template injection: dynamic template rendering

**How to detect:**
```bash
# SQL string concatenation patterns
grep -n "execute.*\`\|execute.*+" file.ts | grep -v "parameterized\|\$"
# Shell execution
grep -n "exec\|spawn\|execSync" file.ts | grep -v "escape\|quote"
```

### 2. Authentication & Authorization
- Missing `@UseGuards(AuthGuard)` on protected endpoints
- Missing user-scoping (user A accessing user B's data)
- `AuthContextService.getCurrentUserId()` not used for data isolation

**How to detect:**
```bash
# Controllers without auth guards
grep -n "@Controller\|@Get\|@Post\|@Put\|@Delete" file.ts | grep -v "UseGuards\|Public"
```

### 3. Secrets Management
- Hardcoded credentials (passwords, API keys, tokens)
- Secrets in logs or error messages
- Environment variables not loaded via `apps/api/src/environments/`

### 4. Cryptography
- Weak hashing algorithms (MD5, SHA1 for security purposes)
- Using `Math.random()` for security tokens

### 5. Input Validation & Output Encoding
- Missing Zod validation on API DTOs
- React `dangerouslySetInnerHTML` with user content
- Path traversal vulnerabilities in agent-tools file operations

### 6. Sensitive Data Exposure
- PII in logs or error messages
- Stack traces shown to API clients
- Sensitive data in Socket.IO events broadcast to wrong clients

### 7. Security Headers & Configuration
- CORS misconfiguration
- `AUTH_DEV_MODE=true` check in production paths

### 8. Dependency Security

```bash
pnpm audit
```

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
  "vulnerability_type": "injection|auth|secrets|crypto|validation|exposure|headers|dependencies",
  "owasp_category": "A01|A02|A03|A04|A05|A06|A07|A08|A09|A10",
  "impact": "What attacker can do",
  "recommendation": "How to fix it securely",
  "confidence": 90
}
```

## Common False Positives

1. **Test/demo code** — Security can be relaxed in test context
2. **Configuration-driven** — CORS allowlist injected at runtime
3. **Framework defaults** — NestJS/Fastify provides security by default
4. **`AUTH_DEV_MODE`** — Development convenience flag; only flag if used outside dev-mode guards

## Project-Specific Checks

- **Agent tool injection:** User-provided tool parameters passed to shell/file operations without sanitization
- **Docker runtime escape:** Runtime module commands that could allow container escape
- **Socket.IO room isolation:** Events broadcast to rooms that other users shouldn't access
- **LiteLLM proxy abuse:** API keys or prompts exposed through the LiteLLM proxy layer
- **GitHub App token scope:** Tokens requested with broader scope than needed

## Review Checklist

- [ ] No SQL/command injection vulnerabilities
- [ ] `@UseGuards(AuthGuard)` on all protected endpoints
- [ ] Authorization validated for user data access (userId scoping)
- [ ] No hardcoded credentials or secrets
- [ ] All user input validated via Zod DTOs
- [ ] No `dangerouslySetInnerHTML` with user content
- [ ] No sensitive data in logs or errors
- [ ] Dependencies checked (`pnpm audit`)

## Severity Guidelines

- **CRITICAL**: Injection vulnerability, hardcoded credentials, auth bypass, RCE in agent-tools
- **HIGH**: Missing authentication, weak crypto, data exposure via Socket.IO
- **MEDIUM**: Missing security headers, validation gap
