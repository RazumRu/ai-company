import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GraphCheckpointWritesEntity } from '../entity/graph-chekpoints-writes.entity';

@Injectable()
export class GraphCheckpointsWritesDao extends BaseDao<GraphCheckpointWritesEntity> {
  constructor(em: EntityManager) {
    super(em, GraphCheckpointWritesEntity);
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
    txEm?: EntityManager,
  ): Promise<void> {
    await this.getRepo(txEm).upsert(data, {
      onConflictFields: [
        'threadId',
        'checkpointNs',
        'checkpointId',
        'taskId',
        'idx',
      ],
      onConflictAction: 'merge',
      onConflictMergeFields: ['channel', 'type', 'value'],
    });
  }
}
