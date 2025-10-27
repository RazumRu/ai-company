import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { BaseNotificationHandler } from './base-notification-handler';

@Injectable()
export class AgentInvokeNotificationHandler extends BaseNotificationHandler<never> {
  readonly pattern = NotificationEvent.AgentInvoke;

  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly graphDao: GraphDao,
  ) {
    super();
  }

  async handle(event: IAgentInvokeNotification): Promise<never[]> {
    const { threadId, graphId, parentThreadId } = event;

    // Get graph to extract createdBy
    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      return [];
    }

    // Determine external thread key: prefer parentThreadId, fallback to current threadId
    const externalThreadKey = parentThreadId ?? threadId;

    // Check if internal thread already exists
    const existingInternalThread = await this.threadDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!existingInternalThread) {
      await this.threadDao.create({
        graphId,
        createdBy: graph.createdBy,
        externalThreadId: externalThreadKey,
      });
    }

    return [];
  }
}
