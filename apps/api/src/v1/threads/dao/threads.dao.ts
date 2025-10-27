import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { ThreadEntity } from '../entity/thread.entity';

export type SearchTerms = Partial<{
  id: string;
  graphId: string;
  ids: string[];
  createdBy: string;
  externalThreadId: string;
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
  }
}
