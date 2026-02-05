import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { RepoIndexEntity } from '../entity/repo-index.entity';
import { RepoIndexStatus } from '../git-repositories.types';

export type RepoIndexSearchTerms = Partial<{
  id: string;
  repositoryId: string;
  status: RepoIndexStatus | RepoIndexStatus[];
}>;

@Injectable()
export class RepoIndexDao extends BaseDao<
  RepoIndexEntity,
  RepoIndexSearchTerms
> {
  public get alias() {
    return 'ri';
  }

  protected get entity() {
    return RepoIndexEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<RepoIndexEntity>,
    params?: RepoIndexSearchTerms,
  ) {
    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.repositoryId) {
      builder.andWhere({ repositoryId: params.repositoryId });
    }

    if (params?.status) {
      if (Array.isArray(params.status)) {
        builder.andWhere(`${this.alias}.status IN (:...statuses)`, {
          statuses: params.status,
        });
      } else {
        builder.andWhere({ status: params.status });
      }
    }
  }

  /**
   * Atomically increment indexedTokens column to avoid race conditions
   * when multiple batches complete concurrently.
   */
  async incrementIndexedTokens(id: string, amount: number): Promise<void> {
    await this.getQueryBuilder()
      .update()
      .set({
        indexedTokens: () => `"indexedTokens" + ${amount}`,
      })
      .where('id = :id', { id })
      .execute();
  }
}
