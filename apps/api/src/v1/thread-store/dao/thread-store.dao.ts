import { raw } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { ThreadStoreEntryEntity } from '../entity/thread-store-entry.entity';

export interface NamespaceSummaryRow {
  namespace: string;
  entryCount: number;
  lastUpdatedAt: Date;
}

@Injectable()
export class ThreadStoreDao extends BaseDao<ThreadStoreEntryEntity> {
  constructor(em: EntityManager) {
    super(em, ThreadStoreEntryEntity);
  }

  async countForNamespace(
    threadId: string,
    namespace: string,
  ): Promise<number> {
    return await this.count({ threadId, namespace });
  }

  /**
   * Upsert a KV entry. On `(threadId, namespace, key)` conflict, replaces
   * `value`, `authorAgentId`, `tags`, and `updatedAt`; never changes `mode`.
   */
  async upsertKvEntry(data: {
    threadId: string;
    namespace: string;
    key: string;
    value: unknown;
    mode: ThreadStoreEntryEntity['mode'];
    authorAgentId?: string | null;
    tags?: string[] | null;
    createdBy: string;
    projectId: string;
  }): Promise<ThreadStoreEntryEntity> {
    return await this.getRepo().upsert(data, {
      onConflictFields: ['threadId', 'namespace', 'key'],
      onConflictAction: 'merge',
      onConflictMergeFields: ['value', 'authorAgentId', 'tags', 'updatedAt'],
    });
  }

  async getByKey(
    threadId: string,
    namespace: string,
    key: string,
  ): Promise<ThreadStoreEntryEntity | null> {
    return await this.getOne({ threadId, namespace, key });
  }

  async getNamespaceSummaries(
    threadId: string,
  ): Promise<NamespaceSummaryRow[]> {
    const rows = await this.em
      .createQueryBuilder(ThreadStoreEntryEntity, 'e')
      .select([
        'e.namespace',
        raw('count(*) as cnt'),
        raw('max(e.updated_at) as last_updated_at'),
      ])
      .where({ threadId, deletedAt: null })
      .groupBy('e.namespace')
      .orderBy({ namespace: 'ASC' })
      .execute<
        { namespace: string; cnt: string; last_updated_at: Date | string }[]
      >();

    return rows.map((row) => ({
      namespace: row.namespace,
      entryCount: parseInt(row.cnt, 10),
      lastUpdatedAt:
        row.last_updated_at instanceof Date
          ? row.last_updated_at
          : new Date(row.last_updated_at),
    }));
  }

  async listInNamespace(
    threadId: string,
    namespace: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ThreadStoreEntryEntity[]> {
    return await this.getAll(
      { threadId, namespace },
      { orderBy: { createdAt: 'DESC' }, ...options },
    );
  }
}
