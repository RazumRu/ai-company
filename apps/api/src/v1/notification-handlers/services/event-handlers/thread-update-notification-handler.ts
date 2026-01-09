import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotFoundException } from '@packages/common';

import { ThreadTokenUsageCacheService } from '../../../cache/services/thread-token-usage-cache.service';
import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IThreadUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IThreadUpdateEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: EnrichedNotificationEvent.ThreadUpdate;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadUpdateNotificationHandler extends BaseNotificationHandler<IThreadUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadUpdate;

  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly moduleRef: ModuleRef,
    private readonly threadTokenUsageCacheService: ThreadTokenUsageCacheService,
  ) {
    super();
  }

  async handle(
    event: IThreadUpdateNotification,
  ): Promise<IThreadUpdateEnrichedNotification[]> {
    const { graphId, threadId, parentThreadId, data } = event;

    const ownerId = await this.getGraphOwner(graphId);

    const externalThreadKey = parentThreadId ?? threadId;

    const thread = await this.threadsDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!thread) {
      return [];
    }

    const updates: Partial<Pick<ThreadEntity, 'status' | 'tokenUsage'>> & {
      name?: string | null;
    } = {};

    if (data.status !== undefined) {
      updates.status = data.status;
    }

    // Only update thread name if it doesn't already exist (set once)
    if (data.name !== undefined && !thread.name) {
      updates.name = data.name ?? null;
    }

    // Flush token usage from Redis to DB when thread completes
    if (
      updates.status &&
      updates.status !== ThreadStatus.Running &&
      thread.status === ThreadStatus.Running
    ) {
      const tokenUsage =
        await this.threadTokenUsageCacheService.flushThreadTokenUsage(
          externalThreadKey,
        );
      if (tokenUsage) {
        // Merge with existing DB token usage to preserve per-node data across multiple runs
        const existingUsage = thread.tokenUsage;
        if (existingUsage?.byNode && tokenUsage.byNode) {
          // Merge byNode data: keep nodes from DB that aren't in Redis
          const mergedByNode = { ...existingUsage.byNode };
          for (const [nodeId, usage] of Object.entries(tokenUsage.byNode)) {
            mergedByNode[nodeId] = usage;
          }
          updates.tokenUsage = {
            ...tokenUsage,
            byNode: mergedByNode,
          };
        } else {
          updates.tokenUsage = tokenUsage;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.threadsDao.updateById(thread.id, updates);
    }

    const updatedThread = await this.threadsDao.getOne({
      id: thread.id,
      graphId,
    });

    if (!updatedThread) {
      return [];
    }

    const threadsService = await this.moduleRef.create(ThreadsService);
    const threadDto = await threadsService.prepareThreadResponse(updatedThread);

    return [
      {
        type: EnrichedNotificationEvent.ThreadUpdate,
        graphId,
        ownerId,
        threadId: externalThreadKey,
        internalThreadId: updatedThread.id,
        scope: [NotificationScope.Graph],
        data: threadDto,
      },
    ];
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    const graph = await this.graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    return graph.createdBy;
  }
}
