import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GraphCheckpointEntity } from '../entity/graph-chekpoints.entity';

@Injectable()
export class GraphCheckpointsDao extends BaseDao<GraphCheckpointEntity> {
  constructor(em: EntityManager) {
    super(em, GraphCheckpointEntity);
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
    await this.getRepo().upsert(data, {
      onConflictFields: ['threadId', 'checkpointNs', 'checkpointId'],
      onConflictAction: 'merge',
      onConflictMergeFields: [
        'parentCheckpointId',
        'parentThreadId',
        'nodeId',
        'type',
        'checkpoint',
        'metadata',
      ],
    });
  }
}
