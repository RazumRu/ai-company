# Guidelines Review Criteria

Code style, naming conventions, documentation, consistency, and compliance with project standards.

## What to Check

### 1. Naming Conventions
- Variable names unclear or misleading (`data`, `x`, `temp`, `result`)
- Inconsistent naming style (must be camelCase for variables/functions, PascalCase for classes/interfaces/enums/types)
- Names don't reflect purpose
- Magic numbers and strings without explanation
- Misleading names (name doesn't match behavior)

**How to detect:**
```bash
# Find single-letter or vague variables
grep -nE "^\s*(const|let)\s+(x|y|z|data|temp|result|obj|arr|str)\b" file.ts
# Check naming inconsistency — snake_case in TypeScript is wrong
grep -nE "\b[a-z]+_[a-z]+" file.ts | grep -v "import\|require\|'.*_.*'"
# Find magic numbers
grep -nE "[0-9]{2,}" file.ts | grep -v "200\|404\|timestamp\|size\|port\|5000\|4000"
```

**Red flags:**
- Variables: `x`, `d`, `v`, `data`, `temp`, `result`, `obj`
- snake_case in TypeScript code (should be camelCase)
- Constants without names (magic numbers/strings)
- Names that don't match what variable stores
- PascalCase for enum members not followed

### 2. Function & Class Naming
- Generic function names (`process`, `handle`, `do`, `execute` without context)
- Function names not describing what they do
- Inconsistent verb tense (get vs gets, create vs creating)
- Class names that don't represent their purpose

**How to detect:**
```bash
# Find generic function names
grep -nE "(async\s+)?function\s+(do|process|handle|execute|run|work)\(" file.ts
grep -nE "(async\s+)?(do|process|handle|execute|run)\s*\(" file.ts
# NestJS service/controller naming
grep -n "class [A-Z]" file.ts | grep -E "Utils|Manager|Handler" | grep -v "Service\|Controller\|Module"
```

**Red flags:**
- Functions: `doSomething()`, `processData()`, `handleIt()`
- Classes: `UtilityManager`, `DataService`, `GeneralHandler`
- No clear verb (get, create, fetch, validate, check, transform)

### 3. Code Formatting & Style
- Inconsistent indentation
- Line length exceeding standard (>120 chars)
- Missing blank lines between logical sections
- Inconsistent brace placement

**How to detect:**
```bash
# Check line length
awk 'length > 120 {print NR": length=" length}' file.ts
```

**Red flags:**
- Lines >120 characters
- Inconsistent spacing before/after braces
- No blank lines between functions/logic blocks

### 4. File Organization
- Functions in `.types.ts` files (types files must only contain types, interfaces, enums, constants)
- Standalone functions in class files (should be in `.utils.ts`)
- Inline imports (`require()` inside functions)
- All imports not at top of file

**How to detect:**
```bash
# Functions in types files
grep -n "^export function\|^function\|^export const.*=>" file.types.ts
# Inline imports
grep -n "require(" file.ts | grep -v "^import"
# Missing *.utils.ts for shared helpers
grep -n "^export function" file.service.ts | grep -v "class"
```

**Red flags:**
- `export function` in a `.types.ts` file
- Helper functions defined in a `.service.ts` or `.controller.ts` file
- `require()` calls inside function bodies
- Imports scattered throughout the file

### 5. Code Duplication
- Copy-pasted code blocks (>5 lines repeated)
- Similar logic in multiple functions
- Utility code scattered across files
- Tests with duplicate setup code
- Constants defined in multiple places

**How to detect:**
```bash
# Find repeated constant values
grep -nE ":\s*['\"].*['\"]\s*[,;}]" file.ts | cut -d: -f2 | sort | uniq -c | sort -rn
```

**Red flags:**
- Same code block appears 2+ times
- Multiple places doing same validation
- Constants defined in multiple files
- Similar function implementations

### 6. Imports & Dependencies
- Unnecessary imports (unused modules)
- Wildcard imports (import *)
- Incorrect import paths (should use `@packages/*` aliases)
- Too many imports in single file

**How to detect:**
```bash
# Find wildcard imports
grep -n "import \*" file.ts
# Check for @packages alias usage
grep -n "from '../../packages" file.ts  # Should use @packages/*
# Count imports per file
grep -c "^import" file.ts
```

**Red flags:**
- `import * as everything from 'module'`
- Relative imports to packages (should use `@packages/*`)
- Imports not used in file
- Relative imports going up many levels (`../../..`)

### 7. Type Safety
- `any` type used (forbidden by project rules)
- Missing type annotations on public functions
- `as` type assertions when proper typing is possible
- `// eslint-disable` without explanation comment

**How to detect:**
```bash
# Find 'any' usage
grep -n ": any\|as any\|<any>" file.ts
# Find eslint-disable without explanation
grep -n "eslint-disable" file.ts | grep -v "//"
# Missing return types on exported functions
grep -n "^export.*function\|^export.*async" file.ts | grep -v ":" 
```

**Red flags:**
- `any` type anywhere (use specific types, generics, or `unknown` + type guards)
- `as any` type assertions
- Functions without parameter/return types
- `// eslint-disable` without justification comment

### 8. Consistency with Codebase (Convention Guard)

This is the most important guideline dimension — AI-generated code's #1 failure mode is introducing new patterns that differ from the repo's existing conventions ("convention drift").

- Different patterns than rest of codebase
- Inconsistent error handling approach (must use `@packages/common` exceptions)
- Different naming style than existing code
- Import styles differ from convention
- DTOs not using Zod with `createZodDto()`
- `return somePromise()` instead of `return await somePromise()`

**How to detect — Exemplar File Comparison:**
```bash
# Find exemplar files — the closest existing files to the changed ones
ls apps/api/src/v1/graphs/ | head -10    # See existing feature files
# Compare patterns between new code and exemplar
head -20 new_file.ts | grep "import"     # New file imports
head -20 exemplar_file.ts | grep "import" # Exemplar imports
# Error handling pattern check
grep -n "throw\|Error\|Exception" new_file.ts
grep -n "throw\|Error\|Exception" exemplar_file.ts
```

**Convention drift signals (specific to AI-generated code):**
- New code uses `throw new Error()` when codebase uses `throw new NotFoundException()` from `@packages/common`
- New DTO uses class-validator instead of Zod + `createZodDto()`
- New code uses `return promise` instead of `return await promise`
- File exports a default when codebase uses named exports
- New utility duplicates an existing one under a different name
- Test file uses `jest` patterns when codebase uses `vitest`

**Red flags:**
- New code using different naming style
- Different error handling than existing code
- New patterns not used elsewhere in the codebase
- Breaks existing architectural patterns
- New dependency added when existing dep covers the use case

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

1. **Single-letter vars in small scope** — OK for short lambdas/loops
   - `array.map(x => x * 2)` is acceptable
   - `for (let i = 0; i < n; i++)` is standard
   - Check scope: if var used in 5+ lines, needs better name

2. **Generic names in tests** — Often acceptable for test setup
   - `const mockGraph = { id: '123', name: 'Test' }`
   - Only flag if confusing within test

3. **Pragmatic duplication** — Sometimes better than premature abstraction
   - Two similar implementations might have different requirements
   - Only flag obvious shared logic

4. **Comments explaining "why"** — These are good, not obvious
   - Explaining business logic or tricky decisions is valuable
   - Only flag comments that state the obvious code

5. **Linter conflicts** — If codebase uses specific config
   - Project uses ESLint + Prettier with specific config
   - Don't flag if matches project config

## Review Checklist

- [ ] Variable names clear and descriptive (camelCase)
- [ ] Class/interface/enum names PascalCase
- [ ] No `any` type usage
- [ ] No functions in `.types.ts` files
- [ ] No standalone functions in class files (use `.utils.ts`)
- [ ] All imports at top of file, using `@packages/*` aliases
- [ ] Code formatting consistent with ESLint/Prettier config
- [ ] No significant code duplication
- [ ] `return await` used for all async returns
- [ ] Error handling uses `@packages/common` exceptions
- [ ] DTOs use Zod with `createZodDto()`
- [ ] Naming consistent with codebase conventions

## Severity Guidelines

- **CRITICAL**: `any` type usage, functions in types files, convention drift introducing incompatible patterns
- **HIGH**: Violates team style guide, naming inconsistency, missing type annotations
- **MEDIUM**: Minor style issues, documentation gaps, minor naming improvements
