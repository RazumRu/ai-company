---
paths:
  - "apps/api/**/*.dao.ts"
  - "apps/api/**/*.service.ts"
---

# Database Query Patterns

## DAO Structure

DAOs extend `BaseDao<EntityType, SearchTerms>` from `@packages/typeorm`. Every DAO must define:

```typescript
@Injectable()
export class ItemDao extends BaseDao<ItemEntity, SearchTerms> {
  public get alias() { return 'i'; }         // short alias for QueryBuilder
  protected get entity() { return ItemEntity; }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<ItemEntity>,
    params?: SearchTerms,
  ) {
    if (params?.id) builder.andWhere({ id: params.id });
    if (params?.createdBy) builder.andWhere({ createdBy: params.createdBy });
    // ... more filters
  }
}
```

## SearchTerms Pattern

Define a `SearchTerms` type with all filterable fields as optional. Prefer generic filter methods over `findByX` proliferation:

```typescript
export type SearchTerms = Partial<{
  id: string;
  ids: string[];
  createdBy: string;
  projectId: string;
  status: ItemStatus;
}>;
```

For array filters, use TypeORM's `In()`: `builder.andWhere({ id: In(params.ids) })`.

## BaseDao Methods (inherited)

- `getAll(params?)` / `getOne(params?)` / `getById(id)` / `count(params?)` -- reads
- `create(data, em?)` / `createMany(data, em?)` / `upsertMany(data, em?)` -- writes
- `updateById(id, data, em?)` / `updateMany(params, data, em?)` -- updates
- `deleteById(id, em?)` / `delete(params?, em?)` -- soft delete
- `hardDeleteById(id, em?)` / `hardDelete(params?, em?)` -- permanent delete
- `restoreById(id, em?)` -- restore soft-deleted

All accept an optional `EntityManager` parameter for transaction support.

## Custom Queries

Use `this.getQueryBuilder()` for complex queries. Always use the alias:

```typescript
const rows = await this.getQueryBuilder()
  .select([`${this.alias}.id`, `${this.alias}.name`])
  .where(`${this.alias}.id IN (:...ids)`, { ids })
  .getMany();
```

## Rules

- **No raw SQL** (`query()`, `createQueryRunner().query()`). Use TypeORM QueryBuilder.
- **No `repository.find()`/`repository.findOne()`** for filtered queries. Use the BaseDao methods with SearchTerms so filters are reusable.
- **Prevent N+1**: use `relations` in `AdditionalParams` or explicit `leftJoinAndSelect()` when you need related entities.
- **Pagination**: use `AdditionalParams.limit`, `offset`, `orderBy` via the BaseDao. Always include an `orderBy` with pagination to ensure stable ordering.
- **Transactions**: pass `entityManager` from `TypeormService.trx()` into DAO methods. Never create standalone transactions in DAOs.
