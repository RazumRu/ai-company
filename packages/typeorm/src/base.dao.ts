import {
  Brackets,
  DataSource,
  DeleteQueryBuilder,
  DeleteQueryBuilder as TypeormDeleteQueryBuilder,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
  UpdateQueryBuilder,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { removeKeysPrefix } from './utils';

type SortDir = 'ASC' | 'DESC';
type OrderInput = Record<string, SortDir> | [string, SortDir][];

export type AdditionalParams<T extends ObjectLiteral = ObjectLiteral> =
  Partial<{
    offset: number;
    limit: number;
    orderBy: string | null;
    sortOrder: SortDir;
    order: OrderInput;
    projection: string[];
    relations: string[];
    withDeleted: boolean;
    rawData: boolean;
    lock?:
      | 'pessimistic_read'
      | 'pessimistic_write'
      | 'dirty_read'
      | 'pessimistic_partial_write'
      | 'pessimistic_write_or_fail'
      | 'for_no_key_update'
      | 'for_key_share';
    updateSelectBuilder: (
      builder: SelectQueryBuilder<T>,
    ) => SelectQueryBuilder<T>;
    customCondition:
      | string
      | Brackets
      | ((qb: SelectQueryBuilder<T>) => string)
      | ObjectLiteral
      | ObjectLiteral[];
  }>;

type StripKeys = 'createdAt' | 'updatedAt' | 'id' | 'deletedAt';

type NullifyUndefined<T> = {
  [K in keyof T]: undefined extends T[K]
    ? Exclude<T[K], undefined> | null | undefined
    : T[K];
};

export type EntityAttributes<T extends ObjectLiteral> = NullifyUndefined<
  Omit<T, StripKeys>
>;

export type EntityAttributesOmit<
  T extends ObjectLiteral,
  OmitKeys extends keyof T,
> = NullifyUndefined<Omit<T, StripKeys | OmitKeys>>;

export type BaseQueryBuilder<T extends ObjectLiteral> =
  | SelectQueryBuilder<T>
  | UpdateQueryBuilder<T>
  | DeleteQueryBuilder<T>;

type EntityType = ObjectLiteral & { id: number | string };

export abstract class BaseDao<
  T extends EntityType,
  U extends ObjectLiteral,
  I extends Partial<EntityAttributes<T>> = EntityAttributes<T>,
> {
  public abstract get alias(): string;

  protected abstract get entity(): EntityTarget<T>;

  protected constructor(private dataSource: DataSource) {}

  protected get repository(): Repository<T> {
    return this.dataSource.getRepository(this.entity);
  }

  protected getQueryRunner() {
    return this.dataSource.createQueryRunner();
  }

  protected getQueryBuilder(entityManager?: EntityManager, alias?: string) {
    return (
      entityManager
        ?.getRepository(this.entity)
        .createQueryBuilder(alias || this.alias) ||
      this.repository.createQueryBuilder(alias || this.alias)
    );
  }

  /**
   * Parameters that will apply to Delete/Update/Get queries
   * @param builder
   * @param params
   * @protected
   */
  protected applySearchParams?(builder: BaseQueryBuilder<T>, params?: U): void;

  private applySearchParamsInternal(
    builder: BaseQueryBuilder<T>,
    params?: U,
  ): void {
    if (params?.withDeleted && 'withDeleted' in builder) {
      builder.withDeleted();
    }

    if (params?.customCondition) {
      builder.andWhere(params.customCondition);
    }

    this.applySearchParams?.(builder, params);
  }

  /**
   * Parameters that will add to get queries
   * @param builder
   * @param params
   * @protected
   */
  protected applyMutationParams?(
    builder: SelectQueryBuilder<T>,
    params?: U,
  ): void;

  private qualify(field: string) {
    if (!field) return field;
    if (field.includes('.')) return field;

    const hasColumn =
      this.repository.metadata.findColumnWithPropertyName(field) ??
      this.repository.metadata.findColumnWithPropertyPath(field);

    return hasColumn ? `${this.alias}.${field}` : field;
  }

  private normalizeOrder(order: OrderInput): [string, SortDir][] {
    if (Array.isArray(order)) {
      return order.map(([f, d]) => [this.qualify(f), d]);
    }

    return Object.entries(order).map(([f, d]) => [this.qualify(f), d]);
  }

  protected applyAdditionalParams(
    builder: SelectQueryBuilder<T>,
    params?: AdditionalParams<T>,
  ) {
    if (params?.order) {
      const entries = this.normalizeOrder(params.order);
      const [first, ...rest] = entries;

      if (first) {
        builder.orderBy(first[0], first[1]);
      }

      for (const [col, dir] of rest) {
        builder.addOrderBy(col, dir);
      }
    } else if (params?.orderBy) {
      builder.orderBy(this.qualify(params.orderBy), params.sortOrder || 'DESC');
    }

    if (params?.limit != null) {
      builder.limit(params.limit);
    }

    if (params?.offset != null) {
      builder.offset(params.offset);
    }

    if (params?.projection?.length) {
      const qualifiedProjection = params.projection.map((p) => this.qualify(p));
      builder.select(qualifiedProjection);
    }

    if (params?.relations?.length) {
      for (const r of params.relations) {
        builder.leftJoinAndSelect(`${this.alias}.${r}`, r);
      }
    }

    if (params?.updateSelectBuilder) {
      params.updateSelectBuilder(builder);
    }

    if (params?.lock) {
      builder.setLock(params.lock);
    }
  }

  public async create(data: I, entityManager?: EntityManager): Promise<T> {
    return (
      await this.getQueryBuilder(entityManager)
        .insert()
        .values(data as QueryDeepPartialEntity<ObjectLiteral>)
        .returning('*')
        .execute()
    ).generatedMaps[0] as T;
  }

  public async createMany(
    data: I[],
    entityManager?: EntityManager,
  ): Promise<T[]> {
    return (
      await this.getQueryBuilder(entityManager)
        .insert()
        .values(data as QueryDeepPartialEntity<ObjectLiteral>)
        .returning('*')
        .execute()
    ).generatedMaps as T[];
  }

  private getPrimaryColumns(): string[] {
    return this.repository.metadata.primaryColumns.map((c) => c.propertyName);
  }

  private getAllColumns(): string[] {
    return this.repository.metadata.columns.map((c) => c.propertyName);
  }

  private getUpsertOverwriteColumns(conflictTarget: string[]) {
    const primary = new Set(this.getPrimaryColumns());
    const conflict = new Set(conflictTarget);

    return this.getAllColumns().filter(
      (c) =>
        !primary.has(c) &&
        !conflict.has(c) &&
        c !== 'createdAt' &&
        c !== 'deletedAt',
    );
  }

  public async upsertMany(
    data: I[],
    entityManager?: EntityManager,
  ): Promise<T[]>;
  public async upsertMany(
    data: I[],
    conflictPaths: string[],
    entityManager?: EntityManager,
  ): Promise<T[]>;
  public async upsertMany(
    data: I[],
    conflictPaths?: string[] | EntityManager,
    entityManager?: EntityManager,
  ): Promise<T[]> {
    if (conflictPaths instanceof EntityManager) {
      entityManager = conflictPaths;
      conflictPaths = undefined;
    }

    if (!data.length) return [];

    const conflictTarget = conflictPaths?.length
      ? conflictPaths
      : this.getPrimaryColumns();

    const overwrite = this.getUpsertOverwriteColumns(conflictTarget);

    const builder = this.getQueryBuilder(entityManager).insert();
    builder.values(data as QueryDeepPartialEntity<ObjectLiteral>);

    if (!conflictTarget.length) {
      const res = await builder.orIgnore().returning('*').execute();
      return (
        Array.isArray(res.raw) && res.raw?.length ? res.raw : res.generatedMaps
      ) as T[];
    }

    const res = await builder
      .orUpdate(overwrite.length ? overwrite : conflictTarget, conflictTarget)
      .returning('*')
      .execute();

    return (
      Array.isArray(res.raw) && res.raw?.length ? res.raw : res.generatedMaps
    ) as T[];
  }

  public async updateMany(
    params: U,
    data: Partial<I>,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    const builder = this.getQueryBuilder(entityManager).update();

    this.applySearchParamsInternal(builder, params);

    const result = await builder
      .set(data as QueryDeepPartialEntity<ObjectLiteral>)
      .returning('*')
      .execute();

    const raw = result.raw as unknown[];
    return (raw[0] as T) || null;
  }

  public async updateById(
    id: T['id'],
    data: Partial<I>,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async updateById(
    id: T['id'],
    data: Partial<I>,
    params?: U,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async updateById(
    id: T['id'],
    data: Partial<I>,
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    if (params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager).update();

    this.applySearchParamsInternal(builder, params as U);
    builder.andWhere({ id });

    const result = await builder
      .set(data as QueryDeepPartialEntity<ObjectLiteral>)
      .returning('*')
      .execute();

    const raw = result.raw as unknown[];
    return (raw[0] as T) || null;
  }

  public async getById(
    id: T['id'],
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async getById(
    id: T['id'],
    params: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async getById(
    id: T['id'],
    params?: (U & AdditionalParams) | EntityManager,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    if (params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager);
    builder.where({ id });

    this.applyAdditionalParams(builder, params as U & AdditionalParams);
    this.applySearchParamsInternal(builder, params as U);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params as U);
    }

    if ((params as AdditionalParams)?.rawData) {
      const res = (await builder.getRawOne()) as Record<string, unknown> | null;
      return res ? (removeKeysPrefix(this.alias, res) as unknown as T) : null;
    }

    return builder.getOne();
  }

  public async count(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<number> {
    const builder = this.getQueryBuilder(entityManager);

    this.applySearchParamsInternal(builder, params as U);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params as U);
    }

    return builder.getCount();
  }

  public async getAll(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T[]> {
    const builder = this.getQueryBuilder(entityManager);

    this.applyAdditionalParams(builder, params);
    this.applySearchParamsInternal(builder, params as U);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params as U);
    }

    if ((params as AdditionalParams)?.rawData) {
      const res = await builder.getRawMany();
      return res?.map((el) => removeKeysPrefix(this.alias, el)) || [];
    }

    return builder.getMany();
  }

  public async getOne(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    const builder = this.getQueryBuilder(entityManager);

    this.applyAdditionalParams(builder, params);
    this.applySearchParamsInternal(builder, params as U);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params as U);
    }

    if ((params as AdditionalParams)?.rawData) {
      const res = (await builder.getRawOne()) as Record<string, unknown> | null;
      return res ? (removeKeysPrefix(this.alias, res) as unknown as T) : null;
    }

    return builder.getOne();
  }

  public async deleteById(
    id: T['id'],
    entityManager?: EntityManager,
  ): Promise<void>;
  public async deleteById(
    id: T['id'],
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async deleteById(
    id: T['id'],
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager)
      .softDelete()
      .where({ id });

    this.applySearchParamsInternal(
      builder as unknown as TypeormDeleteQueryBuilder<T>,
      params as U,
    );

    await builder.execute();
  }

  public async delete(
    params?: U,
    entityManager?: EntityManager,
  ): Promise<void> {
    const builder = this.getQueryBuilder(entityManager).softDelete();

    this.applySearchParamsInternal(
      builder as unknown as TypeormDeleteQueryBuilder<T>,
      params as U,
    );

    await builder.execute();
  }

  public async hardDelete(
    params?: U,
    entityManager?: EntityManager,
  ): Promise<void> {
    const builder = this.getQueryBuilder(entityManager).delete();

    this.applySearchParamsInternal(
      builder as unknown as TypeormDeleteQueryBuilder<T>,
      params as U,
    );

    await builder.execute();
  }

  public async restoreById(
    id: T['id'],
    entityManager?: EntityManager,
  ): Promise<void>;
  public async restoreById(
    id: T['id'],
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async restoreById(
    id: T['id'],
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager).restore().where({ id });

    this.applySearchParamsInternal(
      builder as unknown as TypeormDeleteQueryBuilder<T>,
      params as U,
    );

    await builder.execute();
  }

  public async hardDeleteById(
    id: T['id'],
    entityManager?: EntityManager,
  ): Promise<void>;
  public async hardDeleteById(
    id: T['id'],
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async hardDeleteById(
    id: T['id'],
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager).delete().where({ id });

    this.applySearchParamsInternal(
      builder as unknown as BaseQueryBuilder<T>,
      params as U,
    );

    await builder.execute();
  }
}
