import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadStatus } from '../../../threads/threads.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IAgentStateUpdateEnrichedNotification
  extends IEnrichedNotification<IAgentStateUpdateNotification['data']> {
  type: EnrichedNotificationEvent.AgentStateUpdate;
  nodeId: string;
  threadId: string;
}

@Injectable()
export class AgentStateUpdateNotificationHandler extends BaseNotificationHandler<IAgentStateUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.AgentStateUpdate;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async handle(
    event: IAgentStateUpdateNotification,
  ): Promise<IAgentStateUpdateEnrichedNotification[]> {
    const { threadId, graphId, parentThreadId, data, nodeId } = event;

    // Get graph owner for enriching notification
    const ownerId = await this.getGraphOwner(graphId);

    const notifications: IAgentStateUpdateEnrichedNotification[] = [];

    const agentStateNotification: IAgentStateUpdateEnrichedNotification = {
      type: EnrichedNotificationEvent.AgentStateUpdate,
      graphId,
      ownerId,
      nodeId,
      threadId,
      data,
    };

    notifications.push(agentStateNotification);

    const shouldFetchThread = Boolean(
      data.generatedTitle ||
        data.done !== undefined ||
        data.needsMoreInfo !== undefined,
    );

    if (!shouldFetchThread) {
      return notifications;
    }

    const externalThreadKey = parentThreadId ?? threadId;

    const thread = await this.threadDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!thread) {
      return notifications;
    }

    const updates: Partial<Pick<ThreadEntity, 'name' | 'status'>> = {};

    if (data.generatedTitle && !thread.name) {
      updates.name = data.generatedTitle;
    }

    const nextStatus = this.resolveNextStatus(data, thread.status);

    if (nextStatus && thread.status !== nextStatus) {
      updates.status = nextStatus;
    }

    if (Object.keys(updates).length > 0) {
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadUpdate,
        graphId,
        nodeId,
        threadId: externalThreadKey,
        parentThreadId,
        data: updates,
      });
    }

    return notifications;
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    // Check cache first
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }

    // Fetch from database
    const graph = await this.graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Cache the result
    this.graphOwnerCache.set(graphId, graph.createdBy);

    return graph.createdBy;
  }

  private resolveNextStatus(
    data: IAgentStateUpdateNotification['data'],
    currentStatus: ThreadStatus,
  ): ThreadStatus | undefined {
    if (data.needsMoreInfo) {
      return ThreadStatus.NeedMoreInfo;
    }

    if (data.done) {
      return ThreadStatus.Done;
    }

    // Keep running unless explicitly changed
    if (
      currentStatus === ThreadStatus.NeedMoreInfo &&
      data.needsMoreInfo === false
    ) {
      return ThreadStatus.Running;
    }

    return undefined;
  }
}
