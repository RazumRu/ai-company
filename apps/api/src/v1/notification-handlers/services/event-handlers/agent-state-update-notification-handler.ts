import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IAgentStateUpdateEnrichedNotification extends IEnrichedNotification<
  IAgentStateUpdateNotification['data']
> {
  type: NotificationEvent.AgentStateUpdate;
  nodeId: string;
  threadId: string;
}

@Injectable()
export class AgentStateUpdateNotificationHandler extends BaseNotificationHandler<IAgentStateUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.AgentStateUpdate;

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IAgentStateUpdateNotification,
  ): Promise<IAgentStateUpdateEnrichedNotification[]> {
    const { threadId, parentThreadId, graphId, data, nodeId } = event;
    const externalThreadKey = parentThreadId ?? threadId;

    // Get graph owner for enriching notification
    const ownerId = await this.getGraphOwner(this.graphDao, graphId);

    const notifications: IAgentStateUpdateEnrichedNotification[] = [];

    const agentStateNotification: IAgentStateUpdateEnrichedNotification = {
      type: NotificationEvent.AgentStateUpdate,
      graphId,
      ownerId,
      nodeId,
      threadId: externalThreadKey,
      data,
      scope: [NotificationScope.Graph],
    };

    notifications.push(agentStateNotification);

    // All thread updates (status, name) are now centralized in graph-state-manager
    return notifications;
  }
}
