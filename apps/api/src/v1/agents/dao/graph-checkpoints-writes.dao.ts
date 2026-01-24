import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

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
  SearchTerms
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

  async upsertWriteByKey(
    data: Pick<
      GraphCheckpointWritesEntity,
      | 'threadId'
      | 'checkpointNs'
      | 'checkpointId'
      | 'taskId'
      | 'idx'
      | 'channel'
      | 'type'
      | 'value'
    >,
  ): Promise<void> {
    await this.getQueryBuilder()
      .insert()
      .values(data as QueryDeepPartialEntity<GraphCheckpointWritesEntity>)
      .orUpdate({
        conflict_target: [
          'threadId',
          'checkpointNs',
          'checkpointId',
          'taskId',
          'idx',
        ],
        overwrite: ['channel', 'type', 'value'],
      })
      .execute();
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

    if (typeof params?.idx === 'number') {
      builder.andWhere({
        idx: params.idx,
      });
    }
  }
}
