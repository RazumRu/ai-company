---
paths:
  - "geniro/apps/api/**/*.ts"
  - "geniro/packages/**/*.ts"
---

# API Conventions

## Layered Architecture

Every feature in `apps/api/src/v1/<feature>/` follows: Controller -> Service -> DAO -> Entity.

- **Controllers** are thin: route + validate + delegate. No business logic. Inject `@CtxStorage() ctx: AppContextStorage` to get the current user/project context.
- **Services** own all business logic. First parameter is `ctx: AppContextStorage`. Use `ctx.checkSub()` for userId, `ctx.checkProjectId()` for projectId.
- **DAOs** own all database queries. Extend `BaseDao<Entity, SearchTerms>`. No business logic in DAOs.
- **Entities** are plain TypeORM-decorated classes. Never import services from entities.

## Auth

- Class-level: `@OnlyForAuthorized()` on controllers (from `@packages/http-server`).
- Method-level: `@CtxStorage() ctx: AppContextStorage` parameter decorator to access user context.
- Always validate ownership in services: check `createdBy` / `projectId` matches the requesting user.

## DTOs (Zod)

All DTOs for a module live in a single `dto/<feature>.dto.ts` file:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateItemSchema = z.object({ name: z.string().min(1) });
export class CreateItemDto extends createZodDto(CreateItemSchema) {}
export type CreateItemData = z.infer<typeof CreateItemSchema>;
```

## Transactions

Use `TypeormService.trx()` for multi-step DB writes. Pass `entityManager` down to DAO methods:

```typescript
return this.typeorm.trx(async (em) => {
  const row = await this.dao.create(data, em);
  await this.otherDao.create(otherData, em);
  return row;
});
```

## Events

Use `EventEmitter2` for cross-module communication. Define event constants and typed interfaces in `<feature>.events.ts`:

```typescript
export const GRAPH_DELETED_EVENT = 'graph.deleted';
export interface GraphDeletedEvent { graphId: string; userId: string; }
```

Listen with `@OnEvent(EVENT_CONSTANT)` in a `*Listener` class.

## Real-time Notifications

Use `NotificationsService.emit()` with `NotificationEvent` enum to push events via WebSocket. Notification types are in `notifications/notifications.types.ts`.

## Errors

Throw custom exceptions from `@packages/common`: `NotFoundException`, `BadRequestException`, `ForbiddenException`, `ConflictException`, `InternalException`, `UnauthorizedException`. Never swallow errors silently.

## Imports

- Shared packages: `@packages/common`, `@packages/typeorm`, `@packages/http-server`, `@packages/metrics`.
- Relative imports within the same feature module. Avoid deep cross-feature imports; prefer events or shared packages.
