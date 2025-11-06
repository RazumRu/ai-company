import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IGraphNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IGraphEnrichedNotification
  extends IEnrichedNotification<IGraphNotification['data']> {
  type: EnrichedNotificationEvent.Graph;
}

@Injectable()
export class GraphNotificationHandler extends BaseNotificationHandler<IGraphEnrichedNotification> {
  readonly pattern = NotificationEvent.Graph;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IGraphNotification,
  ): Promise<IGraphEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);

    // Create enriched graph notification
    const enrichedNotification: IGraphEnrichedNotification = {
      ...event,
      type: EnrichedNotificationEvent.Graph,
      ownerId,
      scope: [NotificationScope.Graph],
    };

    return [enrichedNotification];
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
