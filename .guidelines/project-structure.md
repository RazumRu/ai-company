# Project Structure and Description

This document describes the Ai company API project structure and architectural patterns.

## Overview

This is a monorepo project containing a NestJS-based API application and shared packages.

## Monorepo Structure

```
ai-company/
├── apps/
│   └── api/              # Main API application
├── packages/             # Shared libraries and utilities
│   ├── common/          # Common utilities and exceptions
│   ├── cypress/         # Cypress testing utilities
│   ├── http-server/     # HTTP server setup and middleware
│   ├── metrics/         # Metrics and monitoring
│   └── typeorm/         # TypeORM utilities and configurations
├── scripts/             # Utility scripts
└── .docker/             # Docker configuration files
```

## Application Architecture

The API follows a layered architecture pattern:

### 1. Controllers
- Handle HTTP requests and responses
- Located in feature directories (e.g., `src/v1/users/users.controller.ts`)
- Use decorators for routing and validation
- Should be thin - delegate business logic to services

### 2. Services
- Contain business logic
- Located in feature directories (e.g., `src/v1/users/users.service.ts`)
- Orchestrate operations between DAOs
- Handle complex business rules and validations

### 3. DAOs (Data Access Objects)
- Handle database operations
- Located in feature directories (e.g., `src/v1/users/users.dao.ts`)
- Use TypeORM repositories
- Provide methods for CRUD operations and queries

### 4. DTOs (Data Transfer Objects)
- Define data structures for API requests/responses
- Located in feature directories (e.g., `src/v1/users/dto/`)
- Use class-validator decorators for validation
- Separate DTOs for requests and responses

### 5. Entities
- Define database table structures
- Located in feature directories (e.g., `src/v1/users/entities/`)
- Use TypeORM decorators for ORM mapping
- Represent database tables

### 6. Modules
- Organize related features
- Located in feature directories (e.g., `src/v1/users/users.module.ts`)
- Use NestJS dependency injection
- Import and export necessary providers

## Feature Organization

Each feature follows this structure:
```
src/v1/feature-name/
├── dto/                     # Data Transfer Objects
│   ├── feature.dto.ts
├── entities/               # Database entities
│   └── feature.entity.ts
├── feature.controller.ts   # HTTP endpoints
├── feature.service.ts      # Business logic
├── feature.dao.ts          # Data access
└── feature.module.ts       # Module definition
```

## Prerequisites

- Node.js >= 22
- pnpm 10.11.1 or later
- Docker or Podman for running dependencies (PostgreSQL)

## Setting Up the Project

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

## Building the Project

To build the project:
```bash
pnpm build
```

To build only the packages:
```bash
pnpm build:packages
```

## Database Management

### Migrations

The project uses TypeORM for database management:

- Create a new migration:
  ```bash
  cd apps/api
  pnpm migration:create
  ```

- Generate a migration from schema changes:
  ```bash
  cd apps/api
  pnpm run migration:generate
  ```

- Revert the last migration:
  ```bash
  cd apps/api
  pnpm migration:revert
  ```

### Seeding Data

- Create a new seed file:
  ```bash
  cd apps/api
  pnpm seed:create
  ```

- Run all seed files:
  ```bash
  cd apps/api
  pnpm seed:run-all
  ```

## Monorepo Management

- The project uses Turbo for task orchestration
- Workspace packages are referenced with `workspace:*` in package.json
- Shared packages in `packages/` directory are used across applications

