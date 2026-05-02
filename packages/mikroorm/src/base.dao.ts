import type { EntityClass, EntityData } from '@mikro-orm/core';
import {
  type EntityManager,
  type FilterQuery,
  type FindOptions,
  SqlEntityRepository,
} from '@mikro-orm/postgresql';

export abstract class BaseDao<T extends object> {
  constructor(
    protected readonly em: EntityManager,
    private readonly entityClass: EntityClass<T>,
  ) {}

  protected getRepo(em?: EntityManager): SqlEntityRepository<T> {
    return (em ?? this.em).getRepository(
      this.entityClass,
    ) as SqlEntityRepository<T>;
  }

  async getAll(
    where: FilterQuery<T>,
    options?: FindOptions<T, never, keyof T & string>,
    txEm?: EntityManager,
  ): Promise<T[]> {
    return await this.getRepo(txEm).find(where, options as FindOptions<T>);
  }

  async getOne(
    where: FilterQuery<T>,
    options?: FindOptions<T, never, keyof T & string>,
    txEm?: EntityManager,
  ): Promise<T | null> {
    return await this.getRepo(txEm).findOne(where, options as FindOptions<T>);
  }

  async getById(id: string, txEm?: EntityManager): Promise<T | null> {
    return await this.getRepo(txEm).findOne({ id } as FilterQuery<T>);
  }

  async count(where: FilterQuery<T>, txEm?: EntityManager): Promise<number> {
    return await this.getRepo(txEm).count(where);
  }

  async create(data: Partial<T>, txEm?: EntityManager): Promise<T> {
    const manager = txEm ?? this.em;
    const entity = this.getRepo(txEm).create(data as EntityData<T>, {
      partial: true,
    });
    await manager.flush();
    return entity;
  }

  async createMany(data: Partial<T>[], txEm?: EntityManager): Promise<T[]> {
    const manager = txEm ?? this.em;
    const entities = data.map((d) =>
      this.getRepo(txEm).create(d as EntityData<T>, { partial: true }),
    );
    await manager.flush();
    return entities;
  }

  async updateById(
    id: string,
    data: Partial<T>,
    txEm?: EntityManager,
  ): Promise<number> {
    const repo = this.getRepo(txEm);
    const result = await repo.nativeUpdate({ id } as FilterQuery<T>, data as T);
    this.evictById(id, txEm);
    return result;
  }

  async updateAndReturn(
    id: string,
    data: Partial<T>,
    txEm?: EntityManager,
  ): Promise<T> {
    const em = txEm ?? this.em;
    const entity = await this.getRepo(txEm).findOneOrFail({
      id,
    } as FilterQuery<T>);
    Object.assign(entity, data);
    await em.flush();
    return entity;
  }

  async deleteById(id: string, txEm?: EntityManager): Promise<void> {
    await this.getRepo(txEm).nativeUpdate(
      { id } as FilterQuery<T>,
      { deletedAt: new Date() } as T,
    );
    this.evictById(id, txEm);
  }

  async delete(where: FilterQuery<T>, txEm?: EntityManager): Promise<void> {
    const repo = this.getRepo(txEm);
    // Find first so we can evict matching rows from the identity map after the
    // write. Without eviction, subsequent `findOne(id)` reads return the cached
    // entity with deletedAt=null even though the DB row has been soft-deleted.
    const matches = await repo.find(where);
    await repo.nativeUpdate(where, { deletedAt: new Date() } as T);
    // Evict from the calling EM only — see `evictById` for rationale.
    const em = (txEm ?? this.em) as EntityManager;
    for (const entity of matches) {
      this.evictById((entity as unknown as { id: string }).id, em);
    }
  }

  async hardDeleteById(id: string, txEm?: EntityManager): Promise<void> {
    await this.getRepo(txEm).nativeDelete({ id } as FilterQuery<T>);
    this.evictById(id, txEm);
  }

  async hardDelete(where: FilterQuery<T>, txEm?: EntityManager): Promise<void> {
    const repo = this.getRepo(txEm);
    const matches = await repo.find(where);
    await repo.nativeDelete(where);
    // Evict from the calling EM only — see `evictById` for rationale.
    const em = (txEm ?? this.em) as EntityManager;
    for (const entity of matches) {
      this.evictById((entity as unknown as { id: string }).id, em);
    }
  }

  private evictById(id: string, txEm?: EntityManager): void {
    // Evict from the EM that performed the write — the caller's transactional
    // fork (txEm) when given, otherwise the auto-resolved current EM (which
    // is the global EM outside any transactional context).
    //
    // We delete from the identity map directly instead of calling
    // `unsetIdentity`. `unsetIdentity` ALSO flips `__managed = false`,
    // `__originalEntityData = undefined`, `__identifier = undefined` on the
    // entity object. When the same JS instance is referenced from another
    // closure (e.g., a notification handler's `thread` variable, the data
    // field of a previously-emitted notification, or the parent side of a
    // M:N collection), that orphaned reference becomes a "ghost NEW
    // entity": next time MikroORM's UoW walks it (e.g., via cascade from a
    // related entity in `persistStack`, or because something re-`persist`s
    // it), it computes a CREATE changeset with the original `id` and emits
    // INSERT — failing with a PK constraint violation on the row that
    // already exists in the DB.
    //
    // Removing only the identity-map entry avoids that: callers who hold the
    // old reference still see a coherent (managed-looking) snapshot, the
    // next read goes to the DB (which is what eviction wants), and the
    // entity does not silently become a flush hazard.
    const em = (txEm ?? this.em) as EntityManager;
    const uow = em.getUnitOfWork();
    const cached = uow.getById(this.entityClass, id as never);
    if (cached) {
      uow.getIdentityMap().delete(cached);
    }
  }
}
