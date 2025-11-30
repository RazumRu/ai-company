import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { ThreadEntity } from '../entity/thread.entity';
import { ThreadStatus } from '../threads.types';

export type SearchTerms = Partial<{
  id: string;
  graphId: string;
  ids: string[];
  createdBy: string;
  externalThreadId: string;
  status: ThreadStatus;
  statuses: ThreadStatus[];
}>;

@Injectable()
export class ThreadsDao extends BaseDao<ThreadEntity, SearchTerms, string> {
  public get alias() {
    return 't';
  }

  protected get entity() {
    return ThreadEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<ThreadEntity>,
    params?: SearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({
        id: In(params?.ids),
      });
    }

    if (params?.id) {
      builder.andWhere({
        id: params.id,
      });
    }

    if (params?.graphId) {
      builder.andWhere({
        graphId: params.graphId,
      });
    }

    if (params?.createdBy) {
      builder.andWhere({
        createdBy: params.createdBy,
      });
    }

    if (params?.externalThreadId) {
      builder.andWhere({
        externalThreadId: params.externalThreadId,
      });
    }

    if (params?.status) {
      builder.andWhere({
        status: params.status,
      });
    }

    if (params?.statuses && params?.statuses.length > 0) {
      builder.andWhere({
        status: In(params.statuses),
      });
    }
  }

  async touchById(id: string): Promise<void> {
    await this.getQueryBuilder()
      .update()
      .set({
        updatedAt: () => 'CURRENT_TIMESTAMP',
      } as QueryDeepPartialEntity<ThreadEntity>)
      .where({ id })
      .execute();
  }
}
