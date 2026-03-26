---
paths:
  - "apps/api/**/*.entity.ts"
---

# Entity Conventions

## Base Classes

- **`AuditEntity`** (extends `TimestampsEntity`): adds `createdBy: string` and `projectId: string` (both indexed). Use for all user-owned resources.
- **`TimestampsEntity`**: provides `createdAt`, `updatedAt` (timestamptz), `deletedAt` (soft delete). Use for system-owned resources without user ownership.

```typescript
import { AuditEntity } from '../../../auth/audit.entity';

@Entity('items')
export class ItemEntity extends AuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;
}
```

## Column Patterns

- Primary key: always `@PrimaryGeneratedColumn('uuid')` with `id!: string`.
- String columns: `@Column({ type: 'varchar', length: N })` for bounded strings, `@Column({ type: 'text' })` for unbounded.
- Nullable columns: use `@Column({ type: '...', nullable: true })` with TypeScript type `T | null` (not `?`). This matches DB/JSON semantics where `null` is an explicit value distinct from "missing".
- Boolean: `@Column({ type: 'boolean', default: false })`.
- Enum: `@Column({ type: 'enum', enum: MyEnum, default: MyEnum.Default })` with `@Index()`.
- JSONB: `@Column({ type: 'jsonb' })` for structured data, `@Column({ type: 'jsonb', nullable: true })` when optional.

## Relations

- Use string-based relation targets to avoid circular imports: `@OneToMany('ThreadEntity', 'graph')`.
- Mark relation properties with `?` (optional property syntax): `threads?: ThreadEntity[]`. The `?` modifier is appropriate here because relations are only populated when explicitly joined — they are truly optional properties, not nullable DB columns.
- Index foreign key columns: `@Index()` on any column used as a foreign key.

## Soft Delete

All entities inherit `@DeleteDateColumn` from `TimestampsEntity`. BaseDao's `deleteById()` and `delete()` use soft delete by default. Use `hardDeleteById()` only when permanent deletion is required.

## Migrations

- Always generate: `cd apps/api && pnpm run migration:generate`.
- Never hand-write migration files.
- Never use `migration:create`.
