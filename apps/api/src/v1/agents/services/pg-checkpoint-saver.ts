import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Optional, Scope } from '@nestjs/common';
import { ValidationException } from '@packages/common';

import { SUBAGENT_THREAD_PREFIX } from '../agents.types';
import { GraphCheckpointsDao } from '../dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from '../dao/graph-checkpoints-writes.dao';

type Keys = { threadId: string; checkpointNs: string; checkpointId?: string };

@Injectable({ scope: Scope.TRANSIENT })
export class PgCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly graphCheckpointsDao: GraphCheckpointsDao,
    private readonly graphCheckpointsWritesDao: GraphCheckpointsWritesDao,
    private readonly em: EntityManager,
    @Optional() serde?: SerializerProtocol,
  ) {
    super(serde);
  }

  /**
   * Fork the EntityManager to get an isolated connection context.
   * This prevents a failed query from poisoning subsequent operations
   * (PostgreSQL aborts all commands in a transaction after an error).
   */
  private fork(): EntityManager {
    return this.em.fork();
  }

  private k(cfg: RunnableConfig): Keys {
    const c = (cfg?.configurable ?? {}) as Record<string, unknown>;
    const threadId = typeof c.thread_id === 'string' ? c.thread_id : undefined;
    if (!threadId) {
      throw new ValidationException(
        'VALIDATION_ERROR',
        'thread_id is required',
      );
    }

    const checkpointNsFromConfig = c.checkpoint_ns;
    const checkpointNsFromMeta = (
      cfg?.metadata as Record<string, unknown> | undefined
    )?.checkpoint_ns;
    const checkpointNs =
      (typeof checkpointNsFromConfig === 'string' && checkpointNsFromConfig) ||
      (typeof checkpointNsFromMeta === 'string' && checkpointNsFromMeta) ||
      '';

    const checkpointId =
      typeof c.checkpoint_id === 'string' ? c.checkpoint_id : undefined;

    return {
      threadId,
      checkpointNs,
      checkpointId,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = this.k(config);
    const forkedEm = this.fork();
    const doc = await this.graphCheckpointsDao.getOne(
      {
        threadId,
        checkpointNs,
        ...(checkpointId ? { checkpointId } : {}),
      },
      {
        ...(checkpointId ? {} : { orderBy: { checkpointId: 'DESC' } }),
        limit: 1,
      },
      forkedEm,
    );
    if (!doc) {
      return undefined;
    }

    return this.buildCheckpointTuple(doc, true, forkedEm);
  }

  /**
   * Get multiple checkpoint tuples for a thread and all its nested agents.
   * Returns latest checkpoint per unique threadId.
   *
   * @param threadId - Thread ID to search for
   * @param checkpointNs - Checkpoint namespace (default: empty string)
   * @param includeWrites - Whether to include pending writes (default: false)
   * @returns Array of checkpoint tuples with metadata including nodeId
   */
  async getTuples(
    threadId: string,
    checkpointNs = '',
    includeWrites = false,
  ): Promise<(CheckpointTuple & { nodeId?: string })[]> {
    const forkedEm = this.fork();

    // Get all checkpoints for this thread
    const checkpoints = await this.graphCheckpointsDao.getAll(
      { threadId, checkpointNs },
      { orderBy: { checkpointId: 'DESC' } },
      forkedEm,
    );

    // Also get checkpoints where this threadId is the parent (nested agent runs
    // from inter-agent communication in multi-agent graphs).
    // Subagent checkpoints (threadId starts with "subagent-") are excluded
    // because their token usage is already folded into the parent
    // checkpoint by tool-executor-node's aggregatedToolUsage spread.
    const nestedCheckpoints =
      await this.graphCheckpointsDao.getNestedExcludingPrefix(
        threadId,
        checkpointNs,
        SUBAGENT_THREAD_PREFIX,
        forkedEm,
      );

    // Combine and deduplicate - keep latest checkpoint per unique threadId
    const allCheckpoints = [...checkpoints, ...nestedCheckpoints];
    const latestByThread = new Map<string, (typeof allCheckpoints)[0]>();

    for (const checkpoint of allCheckpoints) {
      const existing = latestByThread.get(checkpoint.threadId);
      if (!existing || checkpoint.checkpointId > existing.checkpointId) {
        latestByThread.set(checkpoint.threadId, checkpoint);
      }
    }

    // Build checkpoint tuples for all latest checkpoints
    const tuples: (CheckpointTuple & { nodeId?: string })[] = [];

    for (const doc of latestByThread.values()) {
      try {
        const tuple = await this.buildCheckpointTuple(
          doc,
          includeWrites,
          forkedEm,
        );
        tuples.push({
          ...tuple,
          nodeId: doc.nodeId ?? undefined,
        });
      } catch (_error) {
        // Skip checkpoints that fail to deserialize
        continue;
      }
    }

    return tuples;
  }

  /**
   * Build a checkpoint tuple from a database entity.
   * Shared logic between getTuple and getTuples.
   */
  private async buildCheckpointTuple(
    doc: Awaited<ReturnType<typeof this.graphCheckpointsDao.getOne>>,
    includeWrites = true,
    forkedEm?: EntityManager,
  ): Promise<CheckpointTuple> {
    if (!doc) {
      throw new Error('Document is null or undefined');
    }

    const threadId = doc.threadId;
    const checkpointNs = doc.checkpointNs;

    const pendingWrites = includeWrites
      ? await (async () => {
          const writes = await this.graphCheckpointsWritesDao.getAll(
            {
              threadId,
              checkpointNs,
              checkpointId: doc.checkpointId,
            },
            { orderBy: { taskId: 'ASC', idx: 'ASC' } },
            forkedEm,
          );

          return Promise.all(
            writes.map(
              async (w) =>
                [
                  w.taskId,
                  w.channel,
                  (await this.serde.loadsTyped(
                    w.type,
                    w.value.toString('utf8'),
                  )) as unknown,
                ] as [string, string, unknown],
            ),
          );
        })()
      : [];

    const checkpoint = (await this.serde.loadsTyped(
      doc.type,
      doc.checkpoint.toString('utf8'),
    )) as unknown as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      doc.type,
      doc.metadata.toString('utf8'),
    )) as unknown as CheckpointMetadata;

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: doc.checkpointId,
        },
      },
      checkpoint,
      pendingWrites,
      metadata,
      parentConfig: doc.parentCheckpointId
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: doc.parentCheckpointId,
            },
          }
        : undefined,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs } = this.k(config);
    const before = (
      options?.before?.configurable as Record<string, unknown> | undefined
    )?.checkpoint_id;
    const beforeId = typeof before === 'string' ? before : undefined;
    const forkedEm = this.fork();

    const rows = await this.graphCheckpointsDao.getAll(
      {
        threadId,
        checkpointNs,
        ...(beforeId ? { checkpointId: { $lt: beforeId } } : {}),
      },
      {
        orderBy: { checkpointId: 'DESC' },
        ...(options?.limit ? { limit: options.limit } : {}),
      },
      forkedEm,
    );

    for (const doc of rows) {
      const checkpoint = (await this.serde.loadsTyped(
        doc.type,
        doc.checkpoint.toString('utf8'),
      )) as unknown as Checkpoint;
      const metadata = (await this.serde.loadsTyped(
        doc.type,
        doc.metadata.toString('utf8'),
      )) as unknown as CheckpointMetadata;

      yield {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: doc.checkpointId,
          },
        },
        checkpoint,
        metadata,
        parentConfig: doc.parentCheckpointId
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: doc.parentCheckpointId,
              },
            }
          : undefined,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const { threadId, checkpointNs } = this.k(config);
    const id = checkpoint.id;

    const [[typeA, chk], [typeB, meta]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    if (typeA !== typeB) {
      throw new Error('Mismatched types');
    }

    const parentCheckpointId =
      ((config.configurable as Record<string, unknown> | undefined)
        ?.checkpoint_id as string | undefined) ?? null;

    // Extract parent_thread_id from config for nested agent runs
    const parentThreadId =
      ((config.configurable as Record<string, unknown> | undefined)
        ?.parent_thread_id as string | undefined) ?? null;

    const nodeId =
      ((config.configurable as Record<string, unknown> | undefined)?.node_id as
        | string
        | undefined) ?? null;

    const forkedEm = this.fork();
    await this.graphCheckpointsDao.upsertByCheckpointKey(
      {
        threadId,
        checkpointNs,
        checkpointId: id,
        parentCheckpointId,
        parentThreadId,
        nodeId,
        type: typeA,
        checkpoint: Buffer.from(chk),
        metadata: Buffer.from(meta),
      },
      forkedEm,
    );

    // Note: We do NOT emit notifications from put() to avoid duplicates.
    // Notifications are only emitted from putWrites() which contains the new messages.

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const { threadId, checkpointNs, checkpointId } = this.k(config);
    if (!checkpointId) {
      throw new Error('checkpoint_id required');
    }

    const forkedEm = this.fork();
    await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, ser] = await this.serde.dumpsTyped(value);
        await this.graphCheckpointsWritesDao.upsertWriteByKey(
          {
            threadId,
            checkpointNs,
            checkpointId,
            taskId,
            idx,
            channel,
            type,
            value: Buffer.from(ser),
          },
          forkedEm,
        );
      }),
    );
  }

  /**
   * Delete all checkpoint data for a thread, including child checkpoints
   * from nested agent runs and subagent executions.
   *
   * Finds child threadIds via parentThreadId, then deletes their writes
   * and checkpoints before deleting the root thread's data.
   */
  async deleteThread(threadId: string, ns = ''): Promise<void> {
    const forkedEm = this.fork();

    // Find child checkpoints (nested agents and subagents linked via parentThreadId)
    const childCheckpoints = await this.graphCheckpointsDao.getAll(
      { parentThreadId: threadId },
      undefined,
      forkedEm,
    );

    // Collect unique child threadIds to delete their writes too
    const childThreadIds = [
      ...new Set(childCheckpoints.map((cp) => cp.threadId)),
    ];

    // Delete writes and checkpoints for each child thread
    for (const childThreadId of childThreadIds) {
      await this.graphCheckpointsWritesDao.hardDelete(
        { threadId: childThreadId },
        forkedEm,
      );
      await this.graphCheckpointsDao.hardDelete(
        { threadId: childThreadId },
        forkedEm,
      );
    }

    // Delete the root thread's writes and checkpoints
    await this.graphCheckpointsWritesDao.hardDelete(
      { threadId, checkpointNs: ns },
      forkedEm,
    );
    await this.graphCheckpointsDao.hardDelete(
      { threadId, checkpointNs: ns },
      forkedEm,
    );
  }
}
