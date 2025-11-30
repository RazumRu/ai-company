import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import { BaseNotificationHandler } from './base-notification-handler';

@Injectable()
export class AgentInvokeNotificationHandler extends BaseNotificationHandler<never> {
  readonly pattern = NotificationEvent.AgentInvoke;

  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async handle(event: IAgentInvokeNotification): Promise<never[]> {
    const { threadId, graphId, parentThreadId, source } = event;

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
      const createdThread = await this.threadDao.create({
        graphId,
        createdBy: graph.createdBy,
        externalThreadId: externalThreadKey,
        source,
        status: ThreadStatus.Running,
      });

      // Emit ThreadCreate notification
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadCreate,
        graphId,
        threadId: externalThreadKey,
        internalThreadId: createdThread.id,
        data: createdThread,
      });
    } else {
      const updates: Partial<Pick<ThreadEntity, 'status' | 'source'>> = {};

      if (existingInternalThread.status !== ThreadStatus.Running) {
        updates.status = ThreadStatus.Running;
      }

      if (source && !existingInternalThread.source) {
        updates.source = source;
      }

      const hasUpdates = Object.keys(updates).length > 0;

      if (hasUpdates) {
        await this.threadDao.updateById(existingInternalThread.id, updates);
      } else {
        await this.threadDao.touchById(existingInternalThread.id);
      }

      if (hasUpdates) {
        const refreshedThread = await this.threadDao.getOne({
          id: existingInternalThread.id,
          graphId,
        });

        if (refreshedThread) {
          const threadsService = await this.moduleRef.create(ThreadsService);
          const threadDto =
            threadsService.prepareThreadResponse(refreshedThread);

          await this.notificationsService.emit({
            type: NotificationEvent.ThreadUpdate,
            graphId,
            threadId: externalThreadKey,
            parentThreadId,
            data: threadDto,
          });
        }
      }
    }

    return [];
  }
}
