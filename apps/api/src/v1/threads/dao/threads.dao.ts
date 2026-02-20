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
export class ThreadsDao extends BaseDao<ThreadEntity, SearchTerms> {
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

  /**
   * Returns thread counts grouped by graphId.
   * Each entry contains the total count and the running count.
   */
  async countByGraphIds(
    graphIds: string[],
  ): Promise<Map<string, { total: number; running: number }>> {
    const result = new Map<string, { total: number; running: number }>();
    if (graphIds.length === 0) {
      return result;
    }

    const rows: { graphId: string; status: string; cnt: string }[] =
      await this.getQueryBuilder()
        .select(`${this.alias}.graphId`, 'graphId')
        .addSelect(`${this.alias}.status`, 'status')
        .addSelect('COUNT(*)', 'cnt')
        .where(`${this.alias}.graphId IN (:...graphIds)`, { graphIds })
        .groupBy(`${this.alias}.graphId`)
        .addGroupBy(`${this.alias}.status`)
        .getRawMany();

    for (const row of rows) {
      const count = parseInt(row.cnt, 10);
      const entry = result.get(row.graphId) ?? { total: 0, running: 0 };
      entry.total += count;
      if (row.status === ThreadStatus.Running) {
        entry.running = count;
      }
      result.set(row.graphId, entry);
    }

    return result;
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
