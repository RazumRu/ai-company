# Code Guidelines

This document outlines the coding standards and best practices for the Ai company API project.

## General Principles

### TypeScript Usage

1. **No `any` type**
   - Never use the `:any` type
   - Use specific types, interfaces, or generics instead
   - Use `unknown` if the type is truly unknown, then narrow it with type guards
   
   ```typescript
   // ❌ Bad
   function processData(data: any) { }
   
   // ✅ Good
   function processData(data: UserData) { }
   function processData<T>(data: T) { }
   function processData(data: unknown) {
     if (isUserData(data)) {
       // Process data
     }
   }
   ```

2. **No inline imports**
   - Always use proper import statements at the top of the file
   - Do not use inline imports or require statements within functions
   
   ```typescript
   // ❌ Bad
   function someFunction() {
     const { UserService } = require('./user.service');
   }
   
   // ✅ Good
   import { UserService } from './user.service';
   
   function someFunction() {
     // Use UserService
   }
   ```

## DTO Guidelines

### Use Zod Schemas for DTOs

All DTOs should provide Zod schemas for validation and type inference:

### DTO File Organization

All DTOs related to a module should be kept in one file. No need to create separate files for each new DTO:

```typescript
import { z } from 'zod';
import { createZodDto } from '@anatine/zod-nestjs';

// Define Zod schemas
export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().positive().optional(),
});

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  age: z.number().int().positive().optional(),
});

export const UserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  age: z.number().optional(),
  createdAt: z.date(),
});

// Create DTO classes from schemas
export class CreateUserDto extends createZodDto(CreateUserSchema) {}
export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
export class UserResponseDto extends createZodDto(UserResponseSchema) {}

// Types can be inferred
export type CreateUserData = z.infer<typeof CreateUserSchema>;
export type UpdateUserData = z.infer<typeof UpdateUserSchema>;
export type UserResponseData = z.infer<typeof UserResponseSchema>;
```

## DAO Guidelines

### Prefer Generic Filter Methods

Instead of creating many specific methods, prefer flexible filter-based search methods:

```typescript
// ❌ Bad - Too many specific methods
class UserDao {
  findByEmail(email: string) { }
  findByName(name: string) { }
  findByAge(age: number) { }
  findByEmailAndName(email: string, name: string) { }
  // This grows exponentially...
}

// ✅ Good - Generic filter method
interface UserFilters {
  email?: string;
  name?: string;
  age?: number;
  createdAfter?: Date;
}

class UserDao {
  find(filters: UserFilters) {
    const query = this.repository.createQueryBuilder('user');
    
    if (filters.email) {
      query.andWhere('user.email = :email', { email: filters.email });
    }
    if (filters.name) {
      query.andWhere('user.name ILIKE :name', { name: `%${filters.name}%` });
    }
    if (filters.age) {
      query.andWhere('user.age = :age', { age: filters.age });
    }
    if (filters.createdAfter) {
      query.andWhere('user.createdAt > :createdAfter', { createdAfter: filters.createdAfter });
    }
    
    return query.getMany();
  }
  
  // Only add specific methods when they have complex logic
  findOneByIdWithRelations(id: string) {
    return this.repository.findOne({
      where: { id },
      relations: ['profile', 'posts', 'comments'],
    });
  }
}
```

### DAO Best Practices

- Keep database queries in DAOs, not in services
- Use TypeORM query builder
- Handle database errors appropriately
- Use transactions when needed

## Naming Conventions

- **Classes, interfaces, types, enums**: PascalCase
  ```typescript
  class UserService { }
  interface UserData { }
  type UserId = string;
  enum UserRole { }
  ```

- **Variables, methods, functions, parameters**: camelCase
  ```typescript
  const userName = 'John';
  function getUserById(userId: string) { }
  ```

- **Constants**: UPPER_CASE or camelCase (depending on context)
  ```typescript
  const MAX_RETRY_COUNT = 3;
  const apiConfig = { ... };
  ```

- **Enum members**: PascalCase
  ```typescript
  enum UserRole {
    Admin = 'admin',
    User = 'user',
  }
  ```

## Code Style

### Linting and Formatting

- The project uses ESLint and Prettier for code formatting

### Error Handling

- Use custom exception classes from `@packages/common`
- Provide meaningful error messages
- Log errors appropriately
- Don't swallow errors silently

## Script Execution

### Never Use `--` with npm/pnpm Commands

When running npm or pnpm scripts, do not use `--` to pass parameters:

```bash
# ❌ Bad
pnpm run build -- --example_param=1
npm run test -- --watch

# ✅ Good
pnpm run build --example_param=1
npm run test --watch
```

The `--` separator is unnecessary and should be avoided in all script executions.

## Commit Guidelines

- The project uses conventional commits
- Use `pnpm commit` to create properly formatted commit messages
- Commit messages follow the pattern: `type(scope): message`

Example:
```
feat(users): add email verification endpoint
fix(auth): resolve token refresh issue
docs(readme): update setup instructions
```

## Documentation

- Add JSDoc comments for public APIs
- Document complex logic with inline comments
- Keep comments up-to-date with code changes
- Document "why" not "what" when the code is clear

