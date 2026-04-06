# Guidelines Review Criteria

Code style, naming conventions, documentation, consistency, and compliance with project standards for TypeScript + NestJS + React.

## What to Check

### 1. Naming Conventions
- PascalCase for classes/interfaces/enums/types
- camelCase for variables/functions
- PascalCase for enum members
- UPPER_SNAKE_CASE for constants

**How to detect:**
```bash
grep -nE "^\s*(const|let)\s+[A-Z]" file.ts | grep -v "UPPER_CASE\|^[A-Z][a-z]"
grep -n "function\s+[A-Z]" file.ts
```

**Red flags:**
- snake_case variables in TypeScript
- camelCase class names
- Inconsistent enum member casing

### 2. Type Safety
- No `any` — use specific types, generics, or `unknown` + type guards
- Use `T | null` for nullable (not `T | undefined`) to match DB/JSON semantics
- Use `z.infer<typeof Schema>` to derive types from Zod schemas

**How to detect:**
```bash
grep -n ": any\|as any" file.ts
grep -n "| undefined" file.ts | grep -v "optional\|?"
```

**Red flags:**
- Broad use of `any`
- Return types omitted on public functions
- Type-unsafe casts (`as unknown as T`)

### 3. File Organization
- `*.types.ts` — types, interfaces, enums, constants only. No functions.
- `*.utils.ts` — utility/helper functions
- Class files — only the class, no standalone functions
- All imports at top of file (no inline `require()`)

**How to detect:**
```bash
# Functions in types files
grep -n "function\|=>\|export const.*=" file.types.ts | grep -v "type\|interface\|enum"
# Inline imports
grep -n "require(" file.ts | grep -v "^import"
```

### 4. Code Style
- Always use braces for `if`/`else`/`for`/`while` — even single-line bodies
- Always `return await` async calls (not bare `return somePromise()`)
- Validate inputs early, return/throw early — avoid deep nesting

**How to detect:**
```bash
# Missing braces on single-line if
grep -nE "if\s*\(.*\)\s*[^{]$" file.ts
# Bare return of promise
grep -n "return [a-zA-Z].*(" file.ts | grep -v "await\|new\|{" 
```

### 5. Code Duplication
- Copy-pasted code blocks (>5 lines repeated)
- Similar logic in multiple functions
- Constants defined in multiple places

### 6. Imports & Dependencies
- Use `@packages/*` aliases for shared package imports
- No wildcard imports (`import *`)
- No unused imports
- No `// eslint-disable` without explanation

**How to detect:**
```bash
grep -n "import \*" file.ts
grep -n "eslint-disable" file.ts | grep -v "//.*because\|//.*reason\|//.*needed"
```

### 7. DTO & Validation Patterns
- All DTOs use Zod schemas with `createZodDto()`
- Keep all DTOs for a module in a single file
- Zod `.describe()` for Swagger documentation

### 8. Consistency with Codebase (Convention Guard)

This is the most important dimension — AI-generated code's #1 failure is introducing new patterns.

**How to detect — Exemplar File Comparison:**
```bash
# Find exemplar files
ls apps/api/src/v1/*/controllers/ | head -5
ls apps/api/src/v1/*/services/ | head -5

# Compare patterns
grep -n "^export\|^import\|^class\|^interface" new_file.ts > /tmp/new.txt
grep -n "^export\|^import\|^class\|^interface" exemplar.ts > /tmp/old.txt
```

**Convention drift signals:**
- New code uses a pattern that exists NOWHERE else in the codebase
- Error handling wraps in try/catch when codebase uses custom exceptions
- File exports a default when codebase uses named exports
- New utility function duplicates an existing one under a different name
- New dependency added when existing one covers the use case
- Test file structure doesn't match existing tests (describe/it pattern)

## Output Format

```json
{
  "type": "guidelines",
  "severity": "critical|high|medium",
  "title": "Style or guideline violation",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Description of violation",
  "category": "naming|formatting|comments|duplication|imports|types|consistency",
  "current": "Current code/pattern",
  "expected": "Expected code/pattern",
  "recommendation": "How to fix",
  "confidence": 92
}
```

## Common False Positives

1. **Single-letter vars in small scope** — OK for short lambdas (`array.map(x => x * 2)`)
2. **Generic names in tests** — `const user = createTestUser()` is fine
3. **Pragmatic duplication** — Sometimes better than premature abstraction
4. **JSON.parse returns any** — Known TypeScript limitation
5. **Linter config** — Project ESLint config is authoritative

## Review Checklist

- [ ] Variable/function names clear and descriptive
- [ ] No `any` types (use specific types or `unknown`)
- [ ] File organization follows conventions (types.ts, utils.ts, class files)
- [ ] Always braces on control flow, always `return await`
- [ ] No significant code duplication
- [ ] Imports use `@packages/*` aliases
- [ ] DTOs use Zod + createZodDto pattern
- [ ] Code follows existing codebase conventions (exemplar comparison)
- [ ] No TODO without context

## Severity Guidelines

- **CRITICAL**: Breaks TypeScript strict mode, dangerous patterns (`any` in security path)
- **HIGH**: Convention drift, difficult to understand, significant duplication
- **MEDIUM**: Minor style issues, naming improvements, documentation gaps
