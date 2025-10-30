import { Injectable } from '@nestjs/common';

import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { BaseNotificationHandler } from './base-notification-handler';

@Injectable()
export class AgentStateUpdateNotificationHandler extends BaseNotificationHandler<never> {
  readonly pattern = NotificationEvent.AgentStateUpdate;

  constructor(private readonly threadDao: ThreadsDao) {
    super();
  }

  async handle(event: IAgentStateUpdateNotification): Promise<never[]> {
    const { threadId, graphId, parentThreadId, data } = event;

    // Only update thread name if generatedTitle changed and thread doesn't have a name yet
    if (!data.generatedTitle) {
      return [];
    }

    // Determine external thread key: prefer parentThreadId, fallback to current threadId
    const externalThreadKey = parentThreadId ?? threadId;

    // Find the thread
    const thread = await this.threadDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!thread) {
      // Thread doesn't exist yet, skip
      return [];
    }

    // Only update if thread doesn't have a name yet
    if (!thread.name) {
      await this.threadDao.updateById(thread.id, {
        name: data.generatedTitle,
      });
    }

    return [];
  }
}
