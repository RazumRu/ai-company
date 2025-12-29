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
import { Injectable, Optional, Scope } from '@nestjs/common';
import { ValidationException } from '@packages/common';
import { Brackets } from 'typeorm';

import { GraphCheckpointsDao } from '../dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from '../dao/graph-checkpoints-writes.dao';

type Keys = { threadId: string; checkpointNs: string; checkpointId?: string };

@Injectable({ scope: Scope.TRANSIENT })
export class PgCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly graphCheckpointsDao: GraphCheckpointsDao,
    private readonly graphCheckpointsWritesDao: GraphCheckpointsWritesDao,
    @Optional() serde?: SerializerProtocol,
  ) {
    super(serde);
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
    const doc = await this.graphCheckpointsDao.getOne({
      threadId,
      checkpointNs,
      checkpointId,
      order: checkpointId ? undefined : { checkpointId: 'DESC' },
      limit: 1,
    });
    if (!doc) {
      return undefined;
    }

    const writes = await this.graphCheckpointsWritesDao.getAll({
      threadId,
      checkpointNs,
      checkpointId: doc.checkpointId,
      order: { taskId: 'ASC', idx: 'ASC' },
    });

    const checkpoint = (await this.serde.loadsTyped(
      doc.type,
      doc.checkpoint.toString('utf8'),
    )) as unknown as Checkpoint;
    const metadata = (await this.serde.loadsTyped(
      doc.type,
      doc.metadata.toString('utf8'),
    )) as unknown as CheckpointMetadata;
    const pendingWrites = await Promise.all(
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

    const rows = await this.graphCheckpointsDao.getAll({
      threadId,
      checkpointNs,
      order: { checkpointId: 'DESC' },
      limit: options?.limit,
      customCondition: beforeId
        ? new Brackets((qb) =>
            qb.andWhere(
              `${this.graphCheckpointsDao.alias}.checkpointId < :cid`,
              { cid: beforeId },
            ),
          )
        : undefined,
    });

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

    const existing = await this.graphCheckpointsDao.getOne({
      threadId,
      checkpointNs,
      checkpointId: id,
      limit: 1,
    });

    if (existing) {
      await this.graphCheckpointsDao.updateById(existing.id, {
        parentCheckpointId:
          ((config.configurable as Record<string, unknown> | undefined)
            ?.checkpoint_id as string | undefined) ?? null,
        type: typeA,
        checkpoint: Buffer.from(chk),
        metadata: Buffer.from(meta),
      });
    } else {
      await this.graphCheckpointsDao.create({
        threadId,
        checkpointNs,
        checkpointId: id,
        parentCheckpointId:
          ((config.configurable as Record<string, unknown> | undefined)
            ?.checkpoint_id as string | undefined) ?? null,
        type: typeA,
        checkpoint: Buffer.from(chk),
        metadata: Buffer.from(meta),
      });
    }

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

    await Promise.all(
      writes.map(async ([channel, value], idx) => {
        const [type, ser] = await this.serde.dumpsTyped(value);
        const existing = await this.graphCheckpointsWritesDao.getOne({
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          idx,
          limit: 1,
        });
        if (existing) {
          await this.graphCheckpointsWritesDao.updateById(existing.id, {
            channel,
            type,
            value: Buffer.from(ser),
          });
        } else {
          await this.graphCheckpointsWritesDao.create({
            threadId,
            checkpointNs,
            checkpointId,
            taskId,
            idx,
            channel,
            type,
            value: Buffer.from(ser),
          });
        }
      }),
    );
  }

  async deleteThread(threadId: string, ns = ''): Promise<void> {
    await this.graphCheckpointsWritesDao.hardDelete({
      threadId,
      checkpointNs: ns,
    });
    await this.graphCheckpointsDao.hardDelete({
      threadId,
      checkpointNs: ns,
    });
  }
}
