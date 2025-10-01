# API Development Guidelines

This document provides essential information for developers working on the Lusora API project.

## Build and Configuration Instructions

### Prerequisites
- Node.js >= 22
- pnpm 10.11.1 or later
- Docker or Podman for running dependencies

### Setting Up the Project
1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start the required services (PostgreSQL):
   ```bash
   pnpm deps:up
   ```

3. Start the development server:
   ```bash
   cd apps/api
   pnpm start:dev
   ```
   This will start the server in development mode with hot reloading.

### Building the Project
To build the project:
```bash
pnpm build
```

To build only the packages:
```bash
pnpm build:packages
```

### Database Migrations
The project uses TypeORM for database management. Migration commands:

- Create a new migration:
  ```bash
  cd apps/lusora-api
  pnpm migration:create
  ```

- Generate a migration from schema changes:
  ```bash
  cd apps/lusora-api
  pnpm migration:generate
  ```

- Revert the last migration:
  ```bash
  cd apps/lusora-api
  pnpm migration:revert
  ```

### Seeding Data
- Create a new seed file:
  ```bash
  cd apps/lusora-api
  pnpm seed:create
  ```

- Run all seed files:
  ```bash
  cd apps/lusora-api
  pnpm seed:run-all
  ```

## Testing Information

### Unit Testing
The project uses Vitest for unit testing:

- Run all unit tests:
  ```bash
  pnpm test
  ```

- Run unit tests with coverage:
  ```bash
  pnpm test:cov
  ```

- Run tests for packages only:
  ```bash
  pnpm test:packages
  ```

### E2E Testing
The project uses Cypress for E2E testing:

- Run all E2E tests:
  ```bash
  pnpm test:e2e
  ```

- Run E2E tests against a local server:
  ```bash
  pnpm test:e2e:local
  ```

- Open Cypress UI for interactive testing:
  ```bash
  cd apps/lusora-api
  pnpm test:e2e:open
  ```

- Generate API definitions from Swagger:
  ```bash
  cd apps/lusora-api
  pnpm test:e2e:generate-api
  ```

### Adding New Tests

#### Unit Tests
1. Create test files with `.spec.ts` extension
2. Place them next to the files they test
3. Use Vitest's testing utilities
4. Run with `pnpm test`

#### E2E Tests
1. Create test files with `.cy.ts` extension in the `apps/lusora-api/cypress/e2e` directory
2. Use the helper functions in the corresponding `.helper.ts` files
3. Run with `pnpm test:e2e:local`

## Code Style and Development Guidelines

### Code Style
- The project uses ESLint and Prettier for code formatting
- Run linting: `pnpm lint`
- Fix linting issues: `pnpm lint:fix`

### Naming Conventions
- Classes, interfaces, types, enums: PascalCase
- Variables, methods, functions, parameters: camelCase
- Constants: UPPER_CASE or camelCase
- Enum members: PascalCase

### Commit Guidelines
- The project uses conventional commits
- Use `pnpm commit` to create properly formatted commit messages
- Commit messages follow the pattern: `[$JIRA_TICKET] type(scope): message`

### Project Structure
- `apps/`: Contains the main application(s)
- `packages/`: Contains shared libraries and utilities
- `.docker/`: Contains Docker configuration files
- `scripts/`: Contains utility scripts

### Monorepo Management
- The project uses Turbo for task orchestration
- Workspace packages are referenced with `workspace:*` in package.json
