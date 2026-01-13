import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { GraphCheckpointEntity } from '../entity/graph-chekpoints.entity';

export type SearchTerms = Partial<{
  ids: string[];
  threadId: string;
  checkpointId: string;
  checkpointNs: string;
  parentCheckpointId: string;
  parentThreadId: string;
  nodeId: string;
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

  async upsertByCheckpointKey(
    data: Pick<
      GraphCheckpointEntity,
      | 'threadId'
      | 'checkpointNs'
      | 'checkpointId'
      | 'parentCheckpointId'
      | 'parentThreadId'
      | 'nodeId'
      | 'type'
      | 'checkpoint'
      | 'metadata'
    >,
  ): Promise<void> {
    await this.getQueryBuilder()
      .insert()
      .values(data as QueryDeepPartialEntity<GraphCheckpointEntity>)
      .orUpdate({
        conflict_target: ['threadId', 'checkpointNs', 'checkpointId'],
        overwrite: [
          'parentCheckpointId',
          'parentThreadId',
          'nodeId',
          'type',
          'checkpoint',
          'metadata',
        ],
      })
      .execute();
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

    if (params?.parentThreadId) {
      builder.andWhere({
        parentThreadId: params.parentThreadId,
      });
    }

    if (params?.nodeId) {
      builder.andWhere({
        nodeId: params.nodeId,
      });
    }
  }
}
