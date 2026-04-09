# Guidelines Review Criteria

Code style, naming conventions, documentation, consistency, and compliance with TypeScript/NestJS project standards.

## What to Check

### 1. Naming Conventions
- Variable names unclear or misleading
- Inconsistent naming style (must be camelCase for variables/functions, PascalCase for classes/interfaces/enums/types)
- PascalCase for enum members
- Magic numbers and strings without explanation

**How to detect:**
```bash
grep -nE "^\s*const\s+(x|y|z|data|temp|result|obj|arr|str)\b" file.ts
grep -nE "[0-9]{2,}" file.ts | grep -v "200\|404\|timestamp\|port\|timeout"
```

### 2. Function & Class Naming
- Generic function names (`process`, `handle`, `do`, `execute` without context)
- Inconsistent verb tense

### 3. Code Formatting & Style
- Lines exceeding standard length
- All imports at top of file (no inline `require()`)

### 4. Comments & Documentation
- Missing comments on complex logic
- Comments that state the obvious (prefer code over comments)
- TODO/FIXME comments without context

### 5. Code Duplication
- Copy-pasted code blocks (>5 lines repeated)
- Utility code scattered across files (should be in `*.utils.ts`)

### 6. Imports & Dependencies
- Wildcard imports (`import *`)
- Deep relative imports (`../../..`) — should use `@packages/*` aliases

**How to detect:**
```bash
grep -n "import \*" file.ts
grep -n "from '\.\./\.\./\.\." file.ts
```

### 7. Type Safety
- `any` type used (forbidden — use specific types, generics, or `unknown` + type guards)
- Missing type annotations on public functions
- Functions in `*.types.ts` files (only types/interfaces/enums/constants allowed)
- Standalone functions in class files (should be in `*.utils.ts`)

**How to detect:**
```bash
grep -n ": any\|as any\|<any>" file.ts
```

### 8. Consistency with Codebase (Convention Guard)

AI-generated code's #1 failure mode is introducing patterns that differ from existing conventions.

- Different error handling than rest of codebase (must use `@packages/common` exceptions)
- Different module structure (must follow Controller → Service → DAO → Entity)
- Different DTO pattern (must use Zod + `createZodDto()`)
- Different import style (must use `@packages/*` aliases)

**Convention drift signals:**
- New code uses a pattern that exists NOWHERE else in the codebase
- New utility function duplicates an existing one under a different name
- Code uses a library not in package.json when an existing dep covers the use case

## Output Format

```json
{
  "type": "guidelines",
  "severity": "critical|high|medium",
  "title": "Style or guideline violation",
  "file": "path/to/file.ts",
  "line_start": 42,
  "line_end": 48,
  "description": "Description of the guideline violation",
  "category": "naming|formatting|comments|duplication|imports|types|consistency",
  "current": "Current code/pattern",
  "expected": "Expected code/pattern per guidelines",
  "recommendation": "How to fix it",
  "confidence": 92
}
```

## Common False Positives

1. **Single-letter vars in small scope** — OK for short lambdas: `array.map(x => x * 2)`
2. **Generic names in tests** — Acceptable for test setup
3. **Comments explaining "why"** — Valuable, not obvious

## Project-Specific Checks

- **No `any`:** Forbidden — use specific types, generics, or `unknown` + type guards
- **File organization:** `*.types.ts` for types only, `*.utils.ts` for helpers, class files for classes only
- **DTOs:** All in one file per module, using Zod schemas with `createZodDto()`
- **Nullable:** Use `T | null` (not `T | undefined`) to match DB/JSON semantics
- **Always `return await`:** Not bare `return somePromise()`
- **No `// eslint-disable`** without explanation comment

## Review Checklist

- [ ] No `any` type usage
- [ ] Code formatting consistent (ESLint + Prettier)
- [ ] No significant code duplication
- [ ] Imports use `@packages/*` aliases where applicable
- [ ] Code follows NestJS layered architecture
- [ ] DTOs use Zod + `createZodDto()`
- [ ] Naming consistent with codebase

## Severity Guidelines

- **CRITICAL**: `any` usage, breaks layered architecture, dangerous patterns
- **HIGH**: Violates team conventions (wrong file organization, missing Zod DTOs), significant duplication
- **MEDIUM**: Minor style issues, documentation gaps, naming improvements
