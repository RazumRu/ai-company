# Making Changes Workflow

This document describes the complete workflow for making changes to the codebase.

## Complete Workflow

When making changes to the codebase, follow this workflow to ensure quality and consistency:

### 1. Make Your Changes

- Write your code following the [code guidelines](./code-guidelines.md)
- Follow the [project structure](./project-structure.md)
- Keep changes focused and atomic

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
pnpm test
```

If tests fail:
- Review the error messages
- Fix the broken functionality or update the tests
- Re-run tests until all pass

### 6. Run E2E Tests

Run end-to-end tests to verify the complete flow:

#### Prerequisites for E2E Tests

1. **Start dependencies**:
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

4. **Run Cypress tests**:
   ```bash
   cd apps/api
   pnpm test:e2e:local
   ```

> **Note**: Check `package.json` for exact E2E test commands, as they may vary.

### 7. Review Your Changes

Before committing:
- Review your code changes
- Ensure all tests pass
- Verify the functionality works as expected
- Check for any console warnings or errors

### 8. Commit Your Changes

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
pnpm test

# 6. Run E2E tests (ensure server is running first!)
# Terminal 1: Start dependencies
docker compose up -d

# Terminal 2: Start server
cd apps/api
pnpm start:dev

# Terminal 3: Generate API definitions
cd apps/api
pnpm test:e2e:generate-api

# Terminal 4: Run E2E tests
cd apps/api
pnpm test:e2e:local

# 7. Commit (after all steps pass)
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
- Verify docker-compose is up (PostgreSQL is running)
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
- [ ] All unit tests pass (`pnpm test`)
- [ ] All E2E tests pass (`pnpm test:e2e`)
- [ ] Changes are committed with proper message
- [ ] Code is documented where necessary
- [ ] No debug code or console.logs left in

## Additional Resources

- [Code Guidelines](./code-guidelines.md)
- [Project Structure](./project-structure.md)
- [Testing Guidelines](./testing.md)

