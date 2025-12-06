import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IAgentStateUpdateEnrichedNotification extends IEnrichedNotification<
  IAgentStateUpdateNotification['data']
> {
  type: EnrichedNotificationEvent.AgentStateUpdate;
  nodeId: string;
  threadId: string;
}

@Injectable()
export class AgentStateUpdateNotificationHandler extends BaseNotificationHandler<IAgentStateUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.AgentStateUpdate;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IAgentStateUpdateNotification,
  ): Promise<IAgentStateUpdateEnrichedNotification[]> {
    const { threadId, graphId, data, nodeId } = event;

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
      scope: [NotificationScope.Graph],
    };

    notifications.push(agentStateNotification);

    // All thread updates (status, name) are now centralized in graph-state-manager
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
}
