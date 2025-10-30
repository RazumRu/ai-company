import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
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
  ) {
    super();
  }

  async handle(
    event: IAgentStateUpdateNotification,
  ): Promise<IAgentStateUpdateEnrichedNotification[]> {
    const { threadId, graphId, parentThreadId, data, nodeId } = event;

    // Get graph owner for enriching notification
    const ownerId = await this.getGraphOwner(graphId);

    // Only update thread name if generatedTitle changed and thread doesn't have a name yet
    if (data.generatedTitle) {
      // Determine external thread key: prefer parentThreadId, fallback to current threadId
      const externalThreadKey = parentThreadId ?? threadId;

      // Find the thread
      const thread = await this.threadDao.getOne({
        externalThreadId: externalThreadKey,
        graphId,
      });

      if (thread && !thread.name) {
        // Only update if thread doesn't have a name yet
        await this.threadDao.updateById(thread.id, {
          name: data.generatedTitle,
        });
      }
    }

    // Always return enriched notification for socket broadcasting
    return [
      {
        type: EnrichedNotificationEvent.AgentStateUpdate,
        graphId,
        ownerId,
        nodeId,
        threadId,
        data,
      },
    ];
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
