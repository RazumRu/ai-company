import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { GraphCheckpointEntity } from '../entity/graph-chekpoints.entity';

export type SearchTerms = Partial<{
  ids: string[];
  threadId: string;
  checkpointId: string;
  checkpointNs: string;
  parentCheckpointId: string;
}>;

@Injectable()
export class GraphCheckpointsDao extends BaseDao<
  GraphCheckpointEntity,
  SearchTerms,
  string
> {
  public get alias() {
    return 'ch';
  }

  protected get entity() {
    return GraphCheckpointEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GraphCheckpointEntity>,
    params?: SearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({
        id: In(params?.ids),
      });
    }

    if (params?.threadId) {
      builder.andWhere({
        threadId: params.threadId,
      });
    }

    if (params?.checkpointId) {
      builder.andWhere({
        checkpointId: params.checkpointId,
      });
    }

    if (params?.checkpointNs) {
      builder.andWhere({
        checkpointNs: params.checkpointNs,
      });
    }

    if (params?.parentCheckpointId) {
      builder.andWhere({
        parentCheckpointId: params.parentCheckpointId,
      });
    }
  }
}
