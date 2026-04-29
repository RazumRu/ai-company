import { createHash } from 'node:crypto';

import { raw } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { RepoIndexEntity } from '../entity/repo-index.entity';

@Injectable()
export class RepoIndexDao extends BaseDao<RepoIndexEntity> {
  constructor(em: EntityManager) {
    super(em, RepoIndexEntity);
  }

  async restoreById(id: string): Promise<void> {
    // The default `softDelete` filter restricts matches to `deletedAt IS NULL`,
    // which would make this update a no-op for the very rows we want to revive.
    // Disable the filter so the WHERE clause can find the soft-deleted row.
    await this.getRepo().nativeUpdate(
      { id },
      { deletedAt: null },
      { filters: { softDelete: false } },
    );

    // `nativeUpdate` bypasses the unit of work, so any cached copy of this row
    // in the identity map keeps its stale `deletedAt`. Subsequent `findOne`
    // calls hand back the cached entity, so callers see the row as still
    // soft-deleted. Refresh the cached entity (if present) to sync state.
    const cached = this.em.getUnitOfWork().getById(RepoIndexEntity, id);
    if (cached) {
      await this.em.refresh(cached as RepoIndexEntity);
    }
  }

  /**
   * Atomically increment indexedTokens column to avoid race conditions
   * when multiple batches complete concurrently.
   */
  async incrementIndexedTokens(id: string, amount: number): Promise<void> {
    await this.em
      .createQueryBuilder(RepoIndexEntity)
      .update({ indexedTokens: raw(`indexed_tokens + ${amount}`) })
      .where({ id })
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
    const connection = this.em.getConnection();
    try {
      await connection.execute('SELECT pg_advisory_lock(?)', [lockId]);
      const result = await cb();
      return result;
    } finally {
      try {
        await connection.execute('SELECT pg_advisory_unlock(?)', [lockId]);
      } catch {
        // Best-effort unlock -- connection release will clean up the lock anyway
      }
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
    // Read as signed int64 -- pg_advisory_lock accepts bigint
    return hash.readBigInt64BE(0).toString();
  }
}
