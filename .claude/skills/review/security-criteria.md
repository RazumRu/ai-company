# Security Review Criteria

OWASP-aligned security analysis: injection attacks, authentication/authorization, secrets management, crypto, input validation, and data exposure.

## What to Check

### 1. Injection Vulnerabilities
- SQL injection: unsanitized queries, string concatenation with user input in MikroORM raw queries
- Command injection: shell execution with user input (Dockerode, child_process)
- Template injection: dynamic template rendering

**How to detect:**
```bash
grep -n "execute.*\`\|execute.*\+" file.ts | grep -v "parameterized"
grep -n "exec\|spawn\|Dockerode" file.ts | grep -v "escape\|quote"
grep -n "eval\|new Function" file.ts
```

**Red flags:**
- `em.execute()` with template literals containing user input
- Shell commands built with user data in runtime module
- `eval()`, `new Function()`

### 2. Authentication & Authorization
- Missing `@OnlyForAuthorized()` on protected endpoints
- Missing authorization (user A accessing user B's data via project isolation)
- Bypassed auth checks (not using `AppContextStorage`)

**How to detect:**
```bash
grep -n "@Controller\|@Get\|@Post\|@Put\|@Delete" file.ts | grep -v "OnlyForAuthorized\|Public"
grep -n "async.*@Param\|async.*@Body" file.ts | grep -v "CtxStorage\|contextDataStorage"
```

### 3. Secrets Management
- Hardcoded credentials (passwords, API keys, tokens)
- Secrets in logs or error messages

**How to detect:**
```bash
grep -in "password\|secret\|api[_-]?key\|token\|credential" file.ts | grep -v "config\|env\|process"
grep -n "logger\.\|console\." file.ts | grep -i "password\|secret\|key\|token"
```

### 4. Cryptography
- Weak hashing algorithms (MD5, SHA1 for security)
- `Math.random()` for security tokens

**How to detect:**
```bash
grep -in "md5\|sha1" file.ts
grep -n "Math.random" file.ts
```

### 5. Input Validation & Output Encoding
- Missing Zod validation on DTOs
- `dangerouslySetInnerHTML` in React components
- File upload validation gaps
- Path traversal vulnerabilities

**How to detect:**
```bash
grep -n "dangerouslySetInnerHTML" file.tsx
grep -n "readFile\|writeFile" file.ts | grep -v "path.resolve\|path.join"
```

### 6. Sensitive Data Exposure
- Sensitive data in error messages exposed to clients
- PII in logs
- Stack traces returned to users

### 7. Security Headers & Configuration
- CORS misconfiguration
- Debug mode in production

**How to detect:**
```bash
grep -n "cors\|CORS\|Access-Control" file.ts
grep -in "debug\|NODE_ENV" file.ts
```

### 8. Dependency Security

```bash
pnpm audit
```

## Project-Specific Security Checks

- **Docker sandbox escape**: Verify Dockerode calls properly isolate containers with resource limits
- **LLM prompt injection**: Check that user input passed to LLM agents is properly bounded
- **GitHub token scope**: Verify GitHub App tokens are scoped to minimum required permissions
- **Keycloak token validation**: Ensure JWT tokens are validated on every request
- **Redis/BullMQ data**: Verify no sensitive user data persisted in BullMQ job payloads

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
  "impact": "What attacker can do",
  "recommendation": "How to fix it securely",
  "confidence": 90
}
```

## Common False Positives

1. **Test code** — Security can be relaxed in test context
2. **Configuration-driven** — CORS allowlist injected at runtime
3. **Intentional exposure** — Public API endpoints
4. **Framework defaults** — NestJS/Fastify provide security by default

## Review Checklist

- [ ] No SQL/command injection vulnerabilities
- [ ] `@OnlyForAuthorized()` on protected endpoints
- [ ] Authorization validated via `AppContextStorage`
- [ ] No hardcoded credentials or secrets
- [ ] Strong hashing/encryption algorithms
- [ ] All user input validated via Zod DTOs
- [ ] No `dangerouslySetInnerHTML` with user input
- [ ] No sensitive data in logs or errors
- [ ] Dependencies checked for vulnerabilities

## Severity Guidelines

- **CRITICAL**: Injection vulnerability, hardcoded credentials, auth bypass, sandbox escape
- **HIGH**: Missing authentication, weak crypto, data exposure, missing project isolation
- **MEDIUM**: Missing security headers, validation gap, debug mode in production
