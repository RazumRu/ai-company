# Security Review Criteria

OWASP-aligned security analysis: injection attacks, authentication/authorization, secrets management, crypto, input validation, and data exposure.

## What to Check

### 1. Injection Vulnerabilities
- SQL injection: unsanitized queries, string concatenation in MikroORM raw queries
- Command injection: shell execution with user input (especially in agent-tools)
- NoSQL injection: object construction from untrusted sources
- Template injection: dynamic template rendering

**How to detect:**
```bash
# SQL string concatenation patterns
grep -n "execute.*\`\|execute.*\+" file.ts | grep -v "\\$[0-9]"
# Shell execution
grep -n "exec\|spawn\|execSync" file.ts | grep -v "escape\|quote"
# Dynamic queries — string interpolation in SQL
grep -n "em.execute\|em.getKnex" file.ts | grep "\`"
```

**Red flags:**
- String concatenation with user input in `em.execute()` calls
- Shell commands built with user data in agent-tools
- Database operations without parameterized statements
- Dynamic code evaluation (`eval`, `new Function()`)
- Template literals in SQL contexts

### 2. Authentication & Authorization
- Missing `@OnlyForAuthorized()` decorator on protected endpoints
- Missing `@ApiBearerAuth()` on controllers
- Bypassing `AppContextStorage` for user identity
- Missing authorization (user A accessing user B's data)
- Session/token management issues
- API authentication bypasses

**How to detect:**
```bash
# Controllers without auth decorators
grep -n "@Controller\|@Get\|@Post\|@Put\|@Delete\|@Patch" file.ts | grep -v "OnlyForAuthorized\|ApiBearerAuth\|Public"
# Missing context parameter
grep -n "async.*@Param\|async.*@Body\|async.*@Query" file.ts | grep -v "CtxStorage\|AppContextStorage"
```

**Red flags:**
- Routes without `@OnlyForAuthorized()` middleware
- Missing user ID validation (using user-supplied ID vs verified session)
- Hardcoded credentials or keys
- Disabled security checks in code
- Temporary auth bypass not removed

### 3. Secrets Management
- Hardcoded credentials (passwords, API keys, tokens)
- Secrets in logs or error messages
- Secrets in comments or version control
- Weak secret storage/encryption
- GitHub App private keys or tokens exposed

**How to detect:**
```bash
# Look for hardcoded values
grep -in "password\|secret\|api[_-]?key\|token\|credential" file.ts | grep -v "config\|env\|process"
# Check for secrets in logs
grep -n "logger\.\|console\." file.ts | grep -i "password\|secret\|key\|token"
# Environment variable usage
grep -n "process.env" file.ts
```

**Red flags:**
- String literals matching credential patterns
- Secrets hardcoded in source
- `process.env` not being used for sensitive config
- Secrets logged or returned in error messages
- API keys in URLs or query parameters
- GitHub App credentials exposed in responses

### 4. Cryptography
- Weak hashing algorithms (MD5, SHA1)
- Encryption without authentication (ECB mode, no HMAC)
- Broken random number generation for security purposes
- Outdated crypto libraries
- Missing key rotation

**How to detect:**
```bash
# Weak hashing
grep -in "md5\|sha1\|crc" file.ts | grep -v "comment\|description"
# Crypto library calls
grep -n "crypto\|encrypt\|hash\|cipher" file.ts
# Random number generation
grep -n "Math.random" file.ts
```

**Red flags:**
- MD5 or SHA1 for passwords/tokens
- Using `Math.random()` for security tokens
- No key management strategy visible
- Deprecated crypto modules

### 5. Input Validation & Output Encoding
- Missing Zod DTO validation at controller boundaries
- Insufficient validation (only client-side)
- Missing output encoding for XSS prevention
- File upload validation gaps
- Path traversal vulnerabilities (especially in agent-tools file operations)

**How to detect:**
```bash
# Input handling without Zod DTOs
grep -n "@Body()\|@Query()\|@Param()" file.ts | grep -v "Dto\|Schema"
# Output rendering — XSS risks in React
grep -n "dangerouslySetInnerHTML" file.tsx
# File operations without path validation
grep -n "readFile\|writeFile\|createReadStream" file.ts | grep -v "path.resolve\|path.join"
```

**Red flags:**
- Controller params without Zod DTO validation
- Form input not validated on server-side
- `dangerouslySetInnerHTML` in React components
- File paths not normalized/resolved
- Agent tools allowing path traversal outside sandbox

### 6. Sensitive Data Exposure
- Sensitive data in clear text (no encryption in transit/at rest)
- Overly verbose error messages exposing internals
- Sensitive data in URLs or cache
- Stack traces shown to users
- LLM API keys or model configs leaked to clients

**How to detect:**
- Check if HTTP used instead of HTTPS
- Look for error messages revealing system details
- Find sensitive data in Pino logger calls
- Check cache headers and cookie settings
- Identify data exposure in API responses

**Red flags:**
- PII returned unencrypted in API responses
- System paths in error messages
- Stack traces shown to users
- Sensitive data in cookies without HttpOnly flag
- LLM provider keys or internal URLs in responses

### 7. Security Headers & Configuration
- Missing security headers (CSP, X-Frame-Options, HSTS)
- CORS misconfiguration (overly permissive)
- Missing CSRF protection on state-changing operations
- Debug mode enabled in production
- Fastify security plugin misconfiguration

**How to detect:**
```bash
# CORS configuration
grep -n "cors\|CORS\|Access-Control" file.ts | grep -i "allow\|origin"
# Headers
grep -n "setHeader\|header\|\.set(" file.ts | grep -v "Content-Type\|Authorization"
# Debug flags
grep -in "debug\|development\|NODE_ENV" file.ts
```

**Red flags:**
- `Access-Control-Allow-Origin: *`
- Missing CSP header
- CSRF tokens not validated on mutations
- Debug/verbose logging in production code
- Security checks disabled with env vars

### 8. Dependency Security
- Known vulnerabilities in dependencies
- Outdated packages with security patches
- Untrusted dependencies
- Unmaintained packages

**How to detect:**
```bash
# Check for vulnerabilities
pnpm audit
# Review new dependencies in package.json
```

## Project-Specific Checks

- **Agent tool sandbox escape**: Tools execute inside Docker containers — verify user input cannot escape the sandbox (path traversal, command injection)
- **LLM proxy bypass**: All model calls must route through LiteLLM proxy (port 4000) — never call LLM providers directly
- **Keycloak realm integrity**: Auth configuration is managed externally — never modify Keycloak realm settings from application code
- **GitHub token exposure**: GitHub PAT tokens and App credentials must never appear in logs or API responses
- **Multi-tenant data isolation**: Verify queries always filter by the authenticated user's context

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
  "impact": "What attacker can do with this vulnerability",
  "recommendation": "How to fix it securely",
  "confidence": 90
}
```

## Common False Positives

1. **Legitimate concatenation** — String building isn't always injection
   - Check if values are sanitized before use
   - MikroORM `FilterQuery<T>` is safe by design

2. **Test/demo code** — Security can be relaxed in test context
   - Verify code is in test directory, not production
   - Check for `AUTH_DEV_MODE=true` (dev-only bypass)

3. **Configuration-driven** — Behavior controlled by deployment config
   - CORS allowlist might be injected at runtime
   - Check if values come from secure config sources

4. **Intentional exposure** — Some data is meant to be public
   - Public API endpoints intentionally expose certain data
   - Check API documentation

5. **Defense in depth** — Multiple checks aren't always redundant
   - May have both Zod validation and runtime checks
   - Check if each layer serves a purpose

6. **Framework defaults** — NestJS/Fastify provide security by default
   - Fastify auto-escapes HTML in responses
   - NestJS pipes validate DTOs automatically
   - Don't flag if using framework's recommended patterns

## Review Checklist

- [ ] No SQL/command injection vulnerabilities
- [ ] `@OnlyForAuthorized()` on all protected endpoints
- [ ] Authorization validated via `AppContextStorage` for user data access
- [ ] No hardcoded credentials or secrets
- [ ] Strong hashing/encryption algorithms used
- [ ] All user input validated with Zod DTOs at controller boundary
- [ ] No `dangerouslySetInnerHTML` without sanitization
- [ ] No sensitive data in logs or errors
- [ ] Security headers configured
- [ ] CORS properly restricted
- [ ] Dependencies checked with `pnpm audit`
- [ ] No debug/development code in production

## Severity Guidelines

- **CRITICAL**: Injection vulnerability, hardcoded credentials, auth bypass, RCE path, sandbox escape
- **HIGH**: Missing authentication, weak crypto, CSRF gap, data exposure, missing authorization
- **MEDIUM**: Missing security headers, validation gap, weak validation, missing HTTPS
