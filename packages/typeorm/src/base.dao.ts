import {
  Brackets,
  DataSource,
  DeleteQueryBuilder,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
  UpdateQueryBuilder,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { removeKeysPrefix } from './utils';

// New helpers/types
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

export type BaseQueryBuilder<T extends ObjectLiteral> =
  | SelectQueryBuilder<T>
  | UpdateQueryBuilder<T>
  | DeleteQueryBuilder<T>;

export abstract class BaseDao<
  T extends ObjectLiteral,
  U extends ObjectLiteral,
  K = number,
> {
  public abstract get alias(): string;

  protected abstract get entity(): EntityTarget<T>;

  protected constructor(private dataSource: DataSource) {}

  protected get repository(): Repository<T> {
    return this.dataSource.getRepository(this.entity);
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
      builder.andWhere(params?.customCondition);
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
    return field.includes('.') ? field : `${this.alias}.${field}`;
  }

  private normalizeOrder(order: OrderInput): [string, SortDir][] {
    if (Array.isArray(order)) {
      return order.map(([f, d]) => [this.qualify(f), d]);
    }

    return Object.entries(order).map(([f, d]) => [
      this.qualify(f),
      d as SortDir,
    ]);
  }

  protected applyAdditionalParams(
    builder: SelectQueryBuilder<T>,
    params?: AdditionalParams<T>,
  ) {
    if (params?.order && Object.keys(params.order).length) {
      const entries = this.normalizeOrder(params.order);
      const [first, ...rest] = entries;
      if (first) {
        builder.orderBy(first[0], first[1]);
      }

      for (const [col, dir] of rest) {
        builder.addOrderBy(col, dir);
      }
    } else if (params?.orderBy) {
      builder.orderBy(
        this.qualify(params.orderBy),
        params?.sortOrder || 'DESC',
      );
    }

    if (params?.limit) {
      builder.limit(params.limit);
    }
    if (params?.offset) {
      builder.offset(params.offset);
    }

    if (params?.projection) {
      const qualifiedProjection = params.projection.map((p) => this.qualify(p));
      builder.select(qualifiedProjection);
    }

    if (params?.relations) {
      for (const r of params.relations)
        builder.leftJoinAndSelect(`${this.alias}.${r}`, r);
    }

    if (params?.updateSelectBuilder) {
      params.updateSelectBuilder(builder);
    }
  }

  public async create(
    data: EntityAttributes<T>,
    entityManager?: EntityManager,
  ): Promise<T> {
    return (
      await this.getQueryBuilder(entityManager)
        .insert()
        .values(<QueryDeepPartialEntity<ObjectLiteral>>data)
        .returning('*')
        .execute()
    ).generatedMaps[0] as T;
  }

  public async createMany(
    data: EntityAttributes<T>[],
    entityManager?: EntityManager,
  ): Promise<T[]> {
    return (
      await this.getQueryBuilder(entityManager)
        .insert()
        .values(<QueryDeepPartialEntity<ObjectLiteral>>data)
        .returning('*')
        .execute()
    ).generatedMaps as T[];
  }

  public async updateMany(
    params: U,
    data: Partial<EntityAttributes<T>>,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    const builder = this.getQueryBuilder(entityManager).update();

    this.applySearchParamsInternal(builder, <U>params);

    const result = await builder
      .set(<QueryDeepPartialEntity<ObjectLiteral>>data)
      .returning('*')
      .execute();

    return (result.raw[0] as T) || null;
  }

  public async updateById(
    id: K,
    data: Partial<EntityAttributes<T>>,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async updateById(
    id: K,
    data: Partial<EntityAttributes<T>>,
    params?: U,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async updateById(
    id: K,
    data: Partial<EntityAttributes<T>>,
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    if (params && params instanceof EntityManager) {
      entityManager = params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager).update();

    this.applySearchParamsInternal(builder, <U>params);

    builder.andWhere({ id });

    const result = await builder
      .set(<QueryDeepPartialEntity<ObjectLiteral>>data)
      .returning('*')
      .execute();

    return (result.raw[0] as T) || null;
  }

  public async getById(id: K, entityManager?: EntityManager): Promise<T | null>;
  public async getById(
    id: K,
    params: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T | null>;
  public async getById(
    id: K,
    params?: (U & AdditionalParams) | EntityManager,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    if (!entityManager) {
      entityManager = <EntityManager>params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager);

    builder.where({ id });

    this.applyAdditionalParams(builder, <U & AdditionalParams>params);
    this.applySearchParamsInternal(builder, <U & AdditionalParams>params);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, <U & AdditionalParams>params);
    }

    if ((<AdditionalParams>params)?.rawData) {
      const res = await builder.getRawOne();
      return res ? removeKeysPrefix(this.alias, res) : null;
    } else {
      return builder.getOne();
    }
  }

  public async count(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<number> {
    const builder = this.getQueryBuilder(entityManager);

    this.applySearchParamsInternal(builder, params);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params);
    }

    return builder.getCount();
  }

  public async getAll(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T[]> {
    const builder = this.getQueryBuilder(entityManager);

    this.applyAdditionalParams(builder, params);
    this.applySearchParamsInternal(builder, params);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params);
    }

    if ((<AdditionalParams>params)?.rawData) {
      const res = await builder.getRawMany();

      return res?.map((el) => removeKeysPrefix(this.alias, el)) || [];
    } else {
      return builder.getMany();
    }
  }

  public async getOne(
    params?: U & AdditionalParams,
    entityManager?: EntityManager,
  ): Promise<T | null> {
    const builder = this.getQueryBuilder(entityManager);

    this.applyAdditionalParams(builder, params);
    this.applySearchParamsInternal(builder, params);

    if (this.applyMutationParams) {
      this.applyMutationParams(builder, params);
    }

    if ((<AdditionalParams>params)?.rawData) {
      const res = await builder.getRawOne();

      return res ? removeKeysPrefix(this.alias, res) : null;
    } else {
      return builder.getOne();
    }
  }

  public async deleteById(id: K, entityManager?: EntityManager): Promise<void>;
  public async deleteById(
    id: K,
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async deleteById(
    id: K,
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (!entityManager) {
      entityManager = <EntityManager>params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager)
      .softDelete()
      .where({ id });

    this.applySearchParamsInternal(
      <DeleteQueryBuilder<T>>(<unknown>builder),
      <U>params,
    );

    await builder.execute();
  }

  public async delete(
    params?: U,
    entityManager?: EntityManager,
  ): Promise<void> {
    const builder = this.getQueryBuilder(entityManager).softDelete();

    this.applySearchParamsInternal(
      <DeleteQueryBuilder<T>>(<unknown>builder),
      <U>params,
    );

    await builder.execute();
  }

  public async hardDelete(
    params?: U,
    entityManager?: EntityManager,
  ): Promise<void> {
    const builder = this.getQueryBuilder(entityManager).delete();

    this.applySearchParamsInternal(
      <DeleteQueryBuilder<T>>(<unknown>builder),
      <U>params,
    );

    await builder.execute();
  }

  public async restoreById(id: K, entityManager?: EntityManager): Promise<void>;
  public async restoreById(
    id: K,
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async restoreById(
    id: K,
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (!entityManager) {
      entityManager = <EntityManager>params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager)
      .softDelete()
      .where({ id });

    this.applySearchParamsInternal(
      <DeleteQueryBuilder<T>>(<unknown>builder),
      <U>params,
    );

    await builder.restore().execute();
  }

  public async hardDeleteById(
    id: K,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async hardDeleteById(
    id: K,
    params: U,
    entityManager?: EntityManager,
  ): Promise<void>;
  public async hardDeleteById(
    id: K,
    params?: U | EntityManager,
    entityManager?: EntityManager,
  ): Promise<void> {
    if (!entityManager) {
      entityManager = <EntityManager>params;
      params = undefined;
    }

    const builder = this.getQueryBuilder(entityManager).delete().where({ id });

    this.applySearchParamsInternal(builder, <U>params);

    await builder.execute();
  }
}
