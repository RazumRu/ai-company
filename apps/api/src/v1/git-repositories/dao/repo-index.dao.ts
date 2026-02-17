import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { RepoIndexEntity } from '../entity/repo-index.entity';
import { RepoIndexStatus } from '../git-repositories.types';

export type RepoIndexSearchTerms = Partial<{
  id: string;
  repositoryId: string;
  repositoryIds: string[];
  repoUrl: string;
  status: RepoIndexStatus | RepoIndexStatus[];
  branch: string | string[];
}>;

@Injectable()
export class RepoIndexDao extends BaseDao<
  RepoIndexEntity,
  RepoIndexSearchTerms
> {
  public get alias() {
    return 'ri';
  }

  protected get entity() {
    return RepoIndexEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<RepoIndexEntity>,
    params?: RepoIndexSearchTerms,
  ) {
    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.repositoryId) {
      builder.andWhere({ repositoryId: params.repositoryId });
    }

    if (params?.repositoryIds && params.repositoryIds.length > 0) {
      builder.andWhere({ repositoryId: In(params.repositoryIds) });
    }

    if (params?.repoUrl) {
      builder.andWhere({ repoUrl: params.repoUrl });
    }

    if (params?.branch) {
      if (Array.isArray(params.branch)) {
        builder.andWhere({ branch: In(params.branch) });
      } else {
        builder.andWhere({ branch: params.branch });
      }
    }

    if (params?.status) {
      if (Array.isArray(params.status)) {
        builder.andWhere(`${this.alias}.status IN (:...statuses)`, {
          statuses: params.status,
        });
      } else {
        builder.andWhere({ status: params.status });
      }
    }
  }

  /**
   * Atomically increment indexedTokens column to avoid race conditions
   * when multiple batches complete concurrently.
   */
  async incrementIndexedTokens(id: string, amount: number): Promise<void> {
    await this.getQueryBuilder()
      .update()
      .set({
        indexedTokens: () => `"indexedTokens" + :amount`,
      })
      .where('id = :id', { id })
      .setParameter('amount', amount)
      .execute();
  }

  /**
   * Execute a callback while holding a PostgreSQL advisory lock scoped to
   * a (repositoryId, branch) pair, preventing concurrent getOrInitIndexForRepo
   * calls from racing on the same index.
   *
   * Uses a session-level advisory lock (`pg_advisory_lock`) instead of a
   * transaction-scoped one to avoid holding a transaction open while the
   * callback performs potentially slow operations (git commands, Qdrant calls).
   * The lock is explicitly released in the `finally` block.
   */
  async withIndexLock<T>(
    repositoryId: string,
    branch: string,
    cb: () => Promise<T>,
  ): Promise<T> {
    const lockId = RepoIndexDao.advisoryLockId(repositoryId, branch);
    const runner = this.getQueryRunner();
    await runner.connect();
    try {
      await runner.query('SELECT pg_advisory_lock($1)', [lockId]);
      const result = await cb();
      return result;
    } finally {
      try {
        await runner.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch {
        // Best-effort unlock — connection release will clean up the lock anyway
      }
      await runner.release();
    }
  }

  /**
   * Derive a stable 64-bit integer from (repositoryId, branch) for use as
   * a PostgreSQL advisory lock key.
   */
  private static advisoryLockId(repositoryId: string, branch: string): string {
    const hash = createHash('sha256')
      .update(`${repositoryId}:${branch}`)
      .digest();
    // Read as signed int64 — pg_advisory_lock accepts bigint
    return hash.readBigInt64BE(0).toString();
  }
}
