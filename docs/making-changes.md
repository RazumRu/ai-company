# Making Changes Workflow

This document describes the complete workflow for making changes to the codebase.

## Complete Workflow

When making changes to the codebase, follow this workflow to ensure quality and consistency:

### 1. Make Your Changes

- Write your code following the [code guidelines](./code-guidelines.md)
- Follow the [project structure](./project-structure.md)
- Keep changes focused and atomic
- When database schema changes are involved, generate the migration via `pnpm run migration:generate` from `apps/api` and commit the generated file; never create migration files manually.

### 2. Build the Project

After making changes, build the entire project:

```bash
pnpm build
```

This ensures:
- TypeScript compiles without errors
- All packages are built correctly
- Dependencies between packages are satisfied

### 3. Build Tests

Build the test files:

```bash
pnpm build:tests
```

This ensures:
- Test files compile correctly
- Test dependencies are resolved
- No TypeScript errors in tests

### 4. Fix Linting Issues

Run the linter and fix any issues:

```bash
pnpm lint:fix
```

This automatically fixes:
- Code formatting issues
- Import order problems
- Simple style violations

If there are remaining issues that can't be auto-fixed:
```bash
pnpm lint
```

Review and manually fix any remaining linting errors.

### 5. Run Unit Tests

Run all unit tests to ensure nothing is broken:

```bash
pnpm test:unit
```

> **Note (Agent environment)**: Running integration tests is **not required** right now, because integration testing is **not implemented/maintained for the agent environment**. If you explicitly need it locally, you can run `pnpm test:integration`.

If tests fail:
- Review the error messages
- Fix the broken functionality or update the tests
- Re-run tests until all pass

### 6. Run E2E Tests

Run end-to-end tests to verify the complete flow:

#### Prerequisites for E2E Tests

1. **Start dependencies**:
   ```bash
   pnpm deps:up
   ```
   This uses Podman by default. If you prefer Docker:
   ```bash
   docker compose up -d
   ```

2. **Start the server in background**:
   ```bash
   cd apps/api
   pnpm start:dev &
   ```
   
   Or run in a separate terminal:
   ```bash
   cd apps/api
   pnpm start:dev
   ```

3. **Generate API definitions** (required before E2E tests):
   ```bash
   cd apps/api
   pnpm test:e2e:generate-api
   ```

   > Always use this script to refresh Swagger-based API types. Do **not** add or edit the generated files manually.

4. **Run Cypress tests**:
   ```bash
   cd apps/api
   pnpm test:e2e:local
   ```

> **Note**: Check `package.json` for exact E2E test commands, as they may vary.

#### Faster local loop (recommended): run one spec at a time

When iterating locally, don't run the whole E2E suite after each change. Instead, run one spec at a time, fix failures, then continue with the next spec.

- Run a single spec:
  ```bash
  cd apps/api
  pnpm test:e2e:local --spec "cypress/e2e/notifications/socket.cy.ts"
  ```

- Get a list of spec files:
  ```bash
  cd apps/api
  find cypress/e2e -type f \( -name "*.cy.ts" -o -name "*.cy.js" \) | sort
  ```

- Run specs sequentially, stopping on first failure (Bash/Zsh):
  ```bash
  cd apps/api
  find cypress/e2e -type f \( -name "*.cy.ts" -o -name "*.cy.js" \) | sort | \
  while IFS= read -r spec; do
    echo "Running $spec"
    pnpm test:e2e:local --spec "$spec" || { echo "Failed: $spec"; break; }
  done
  ```

- Windows PowerShell (optional):
  ```powershell
  cd apps/api
  $specs = Get-ChildItem -Path cypress/e2e -Recurse -Include *.cy.ts,*.cy.js | Sort-Object FullName
  foreach ($s in $specs) {
    Write-Host "Running $($s.FullName)"
    pnpm test:e2e:local --spec "$($s.FullName)"
    if ($LASTEXITCODE -ne 0) { throw "Failed: $($s.FullName)" }
  }
  ```

See the detailed guidance and more examples in Testing Guidelines: [Speeding up E2E locally: run one spec at a time](./testing.md#speeding-up-e2e-locally-run-one-spec-at-a-time)

### 7. Review Your Changes

Before committing:
- Review your code changes
- Ensure all tests pass
- Verify the functionality works as expected
- Check for any console warnings or errors

### 8. Run Full Check (mandatory before finishing)

Run the full project check to validate build, lint, and tests in one go:

```bash
pnpm run full-check
```

Do this after your changes and before considering the work finished or ready for review.

### 9. Commit Your Changes

Use conventional commits:

```bash
pnpm commit
```

This will guide you through creating a properly formatted commit message following the pattern:
```
type(scope): message
```

Examples:
```
feat(users): add email verification
fix(auth): resolve token refresh issue
refactor(dao): improve query performance
```

## Quick Reference Commands

Here's the complete sequence in order:

```bash
# 1. Make your changes
# ... edit files ...

# 2. Build
pnpm build

# 3. Build tests
pnpm build:tests

# 4. Fix linting
pnpm lint:fix

# 5. Run unit tests
pnpm test:unit

# (Optional) Run integration tests (not required for agent environment)
pnpm test:integration

# 6. Run E2E tests (ensure server is running first!)
# Terminal 1: Start dependencies
pnpm deps:up

# Terminal 2: Start server
cd apps/api
pnpm start:dev

# Terminal 3: Generate API definitions
cd apps/api
pnpm test:e2e:generate-api

# Terminal 4: Run E2E tests
cd apps/api
pnpm test:e2e:local

# 7. Full check (before finishing)
pnpm run full-check

# 8. Commit (after all steps pass)
pnpm commit
```

## Troubleshooting

### Build Fails

- Check TypeScript errors in the output
- Ensure all imports are correct
- Verify package dependencies are installed

### Lint Fails

- Run `pnpm lint` to see specific issues
- Fix issues manually if `lint:fix` doesn't resolve them
- Check for unused variables, imports, or formatting issues

### Tests Fail

- Read the error messages carefully
- Check if you need to update mocks or fixtures
- Ensure database schema matches entity changes
- Run individual test files to isolate issues

### E2E Tests Fail

- Ensure the server is running and accessible
- Verify dependencies are up (`pnpm deps:up`, or Docker/Podman compose)
- Check if the server is in a clean state
- Review Cypress output for specific failures

## Best Practices

1. **Run tests frequently** during development, not just at the end
2. **Fix issues immediately** rather than accumulating technical debt
3. **Keep commits atomic** - one logical change per commit
4. **Write tests** for new features and bug fixes
5. **Document** complex changes in code comments
6. **Review your own PR** before requesting review from others

## Pre-Push Checklist

Before pushing your changes:

- [ ] All builds pass (`pnpm build`)
- [ ] Tests build successfully (`pnpm build:tests`)
- [ ] No linting errors (`pnpm lint:fix`)
- [ ] All unit tests pass (`pnpm test:unit`)
- [ ] All E2E tests pass (`pnpm test:e2e`)
- [ ] Changes are committed with proper message
- [ ] Code is documented where necessary
- [ ] No debug code or console.logs left in

## Additional Resources

- [Code Guidelines](./code-guidelines.md)
- [Project Structure](./project-structure.md)
- [Testing Guidelines](./testing.md)

