import { EntityManager, QueryOrder } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GraphCheckpointEntity } from '../entity/graph-chekpoints.entity';

@Injectable()
export class GraphCheckpointsDao extends BaseDao<GraphCheckpointEntity> {
  constructor(em: EntityManager) {
    super(em, GraphCheckpointEntity);
  }

  async getNestedExcludingPrefix(
    parentThreadId: string,
    checkpointNs: string,
    threadIdPrefix: string,
    txEm?: EntityManager,
  ): Promise<GraphCheckpointEntity[]> {
    return await this.getRepo(txEm)
      .createQueryBuilder('c')
      .where({
        parentThreadId,
        checkpointNs,
      })
      .andWhere('c.thread_id not like ?', [`${threadIdPrefix}%`])
      .orderBy({ checkpointId: QueryOrder.DESC })
      .getResultList();
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
    txEm?: EntityManager,
  ): Promise<void> {
    await this.getRepo(txEm).upsert(data, {
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
