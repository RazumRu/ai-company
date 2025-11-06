import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IThreadUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadDto, ThreadSchema } from '../../../threads/dto/threads.dto';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IThreadUpdateEnrichedNotification
  extends IEnrichedNotification<ThreadDto> {
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

    const updates: Partial<Pick<ThreadEntity, 'status' | 'name'>> = {};

    if (data.status !== undefined) {
      updates.status = data.status;
    }

    if (data.name !== undefined) {
      updates.name = data.name;
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

    const threadDto = ThreadSchema.parse({
      ...updatedThread,
      createdAt: updatedThread.createdAt.toISOString(),
      updatedAt: updatedThread.updatedAt.toISOString(),
      metadata: updatedThread.metadata ?? {},
      source: updatedThread.source ?? null,
      name: updatedThread.name ?? null,
    });

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
