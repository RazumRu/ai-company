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
    return await this.getRepo(txEm).nativeUpdate(
      { id } as FilterQuery<T>,
      data as T,
    );
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
  }

  async hardDeleteById(id: string, txEm?: EntityManager): Promise<void> {
    await this.getRepo(txEm).nativeDelete({ id } as FilterQuery<T>);
  }

  async hardDelete(where: FilterQuery<T>, txEm?: EntityManager): Promise<void> {
    await this.getRepo(txEm).nativeDelete(where);
  }
}
