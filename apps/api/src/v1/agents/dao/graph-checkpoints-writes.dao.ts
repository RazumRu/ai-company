import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { GraphCheckpointWritesEntity } from '../entity/graph-chekpoints-writes.entity';

export type SearchTerms = Partial<{
  ids: string[];
  threadId: string;
  checkpointId: string;
  checkpointNs: string;
  taskId: string;
  idx: number;
}>;

@Injectable()
export class GraphCheckpointsWritesDao extends BaseDao<
  GraphCheckpointWritesEntity,
  SearchTerms,
  string
> {
  public get alias() {
    return 'chw';
  }

  protected get entity() {
    return GraphCheckpointWritesEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GraphCheckpointWritesEntity>,
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

    if (params?.taskId) {
      builder.andWhere({
        taskId: params.taskId,
      });
    }

    if (params?.idx) {
      builder.andWhere({
        idx: params.idx,
      });
    }
  }
}
