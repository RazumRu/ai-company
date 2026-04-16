import { Injectable } from '@nestjs/common';

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
import { clearWaitMetadata } from '../../../threads/threads.utils';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IThreadUpdateEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: NotificationEvent.ThreadUpdate;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadUpdateNotificationHandler extends BaseNotificationHandler<IThreadUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadUpdate;

  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly threadsService: ThreadsService,
  ) {
    super();
  }

  async handle(
    event: IThreadUpdateNotification,
  ): Promise<IThreadUpdateEnrichedNotification[]> {
    const { graphId, threadId, parentThreadId, data } = event;

    const { ownerId, projectId } = await this.getGraphInfo(
      this.graphDao,
      graphId,
    );

    const externalThreadKey = parentThreadId ?? threadId;

    const thread = await this.threadsDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!thread) {
      return [];
    }

    const updates: Partial<Pick<ThreadEntity, 'status' | 'name' | 'metadata'>> =
      {};

    if (data.status !== undefined) {
      updates.status = data.status;
    }

    // Only update thread name if it doesn't already exist (set once)
    if (data.name !== undefined && !thread.name) {
      updates.name = data.name ?? undefined;
    }

    // Clear wait metadata when transitioning away from Waiting to a terminal state.
    // This prevents stale scheduledResumeAt/waitReason from lingering when the
    // agent finishes a run that superseded the waiting state.
    if (
      thread.status === ThreadStatus.Waiting &&
      data.status !== undefined &&
      data.status !== ThreadStatus.Waiting
    ) {
      updates.metadata = clearWaitMetadata(thread.metadata);
    }

    // Three-way semantics for stopReason (applied AFTER wait-metadata clearing so
    // a cost-limit stop on a previously-waiting thread clears wait keys AND sets
    // stopReason in one write):
    //   undefined   -> key is absent on data: leave metadata.stopReason untouched
    //   null        -> explicit clear: drop metadata.stopReason
    //   string      -> persist metadata.stopReason
    if ('stopReason' in data) {
      const baseMeta =
        updates.metadata ??
        (thread.metadata as Record<string, unknown> | null | undefined) ??
        {};
      const nextMeta = { ...baseMeta };
      if (data.stopReason === null) {
        delete nextMeta.stopReason;
      } else if (typeof data.stopReason === 'string') {
        nextMeta.stopReason = data.stopReason;
      }
      updates.metadata = nextMeta;
    }

    // Three-way semantics for stopCostUsd mirror stopReason:
    //   undefined -> key is absent on data: leave metadata.stopCostUsd untouched
    //   null      -> explicit clear: drop metadata.stopCostUsd
    //   number    -> persist metadata.stopCostUsd
    if ('stopCostUsd' in data) {
      const baseMeta =
        updates.metadata ??
        (thread.metadata as Record<string, unknown> | null | undefined) ??
        {};
      const nextMeta = { ...baseMeta };
      if (data.stopCostUsd === null) {
        delete nextMeta.stopCostUsd;
      } else if (typeof data.stopCostUsd === 'number') {
        nextMeta.stopCostUsd = data.stopCostUsd;
      }
      updates.metadata = nextMeta;
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

    const threadDto =
      await this.threadsService.prepareThreadResponse(updatedThread);

    return [
      {
        type: NotificationEvent.ThreadUpdate,
        graphId,
        projectId,
        ownerId,
        threadId: externalThreadKey,
        internalThreadId: updatedThread.id,
        scope: [NotificationScope.Graph],
        data: threadDto,
      },
    ];
  }
}
