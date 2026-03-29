---
paths:
  - "apps/api/**/*.dao.ts"
  - "apps/api/**/*.service.ts"
---

# Database Query Patterns

## DAO Structure

DAOs extend `BaseDao<Entity>` from `@packages/mikroorm` and inject `EntityManager` from `@mikro-orm/postgresql`. Standard CRUD methods are inherited from `BaseDao`:

```typescript
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

@Injectable()
export class ItemDao extends BaseDao<ItemEntity> {
  protected readonly entityClass = ItemEntity;

  constructor(em: EntityManager) {
    super(em);
  }

  // Only add custom methods here -- standard CRUD is inherited from BaseDao
}
```

## FilterQuery Pattern

Use MikroORM's `FilterQuery<T>` for type-safe filtering:

```typescript
// Simple equality
await this.em.find(ItemEntity, { createdBy: userId, projectId });

// Array filter using $in operator
await this.em.find(ItemEntity, { id: { $in: ids } });

// Comparison operators
await this.em.find(ItemEntity, { lastUsedAt: { $lt: new Date() } });

// ILIKE search
await this.em.find(ItemEntity, { name: { $ilike: `%${query}%` } });

// OR conditions
await this.em.find(ItemEntity, { $or: [{ title: { $ilike: query } }, { summary: { $ilike: query } }] });

// Null checks
await this.em.find(ItemEntity, { deletedAt: null }); // IS NULL
await this.em.find(ItemEntity, { deletedAt: { $ne: null } }); // IS NOT NULL
```

## BaseDao Methods (inherited)

- `getAll(where, options?)` / `getOne(where, options?)` / `getById(id)` / `count(where)` -- reads
- `create(data, txEm?)` / `createMany(data, txEm?)` -- writes
- `updateById(id, data, txEm?)` -- updates (returns row count)
- `deleteById(id)` -- soft delete (sets `deletedAt`)
- `hardDeleteById(id)` / `hardDelete(where)` -- permanent delete

All accept an optional `txEm?: EntityManager` parameter for transaction support.

## Custom Queries

Always use MikroORM QueryBuilder (`em.createQueryBuilder()`) for queries that go beyond simple `find`/`findOne`/`count`. Use `raw()` from `@mikro-orm/core` for SQL expressions within QueryBuilder (e.g., atomic increments):

```typescript
// Aggregation with GROUP BY
const rows = await this.em
  .createQueryBuilder(ThreadEntity, 't')
  .select(['t.graphId', 't.status', 'count(*) as cnt'])
  .where({ graphId: { $in: graphIds } })
  .groupBy(['t.graphId', 't.status'])
  .execute<{ graphId: string; status: string; cnt: string }[]>();

// Atomic increment with raw expression
import { raw } from '@mikro-orm/core';
await this.em
  .createQueryBuilder(RepoIndexEntity)
  .update({ indexedTokens: raw(`indexed_tokens + ${amount}`) })
  .where({ id })
  .execute();

// Bulk upsert
await this.getRepo().upsertMany(data, {
  onConflictFields: ['owner', 'repo'],
  onConflictAction: 'merge',
  onConflictMergeFields: ['url', 'updatedAt'],
});
```

Raw SQL via `em.getConnection().execute()` is only acceptable for PostgreSQL-specific operators with no MikroORM equivalent (e.g., `?|` array overlap, `pg_advisory_lock`).

## Rules

- **No raw SQL** — always use QueryBuilder or EntityRepository methods. Raw SQL (`em.getConnection().execute()`) is only allowed for PostgreSQL-specific operators (array overlap `?|`, advisory locks) that have no MikroORM equivalent.
- **Soft delete via @Filter**: entities with `TimestampsEntity`/`AuditEntity` have a `softDelete` filter enabled by default. To include deleted rows: `{ filters: { softDelete: false } }`.
- **Prevent N+1**: use `populate` in FindOptions when you need related entities.
- **Pagination**: use `limit`, `offset`, `orderBy` in FindOptions. Always include `orderBy` with pagination.
- **Transactions**: use `em.transactional()` in services. Pass the transactional EM to DAO methods via `txEm` parameter. Never create standalone transactions in DAOs.
- **Naming**: MikroORM uses `UnderscoreNamingStrategy` -- camelCase in code maps to snake_case in DB automatically.
