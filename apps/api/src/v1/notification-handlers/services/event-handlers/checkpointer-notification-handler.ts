import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  ICheckpointerNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface ICheckpointerEnrichedNotification
  extends IEnrichedNotification<ICheckpointerNotification['data']> {
  type: EnrichedNotificationEvent.Checkpointer;
}

@Injectable()
export class CheckpointerNotificationHandler extends BaseNotificationHandler<ICheckpointerEnrichedNotification> {
  readonly pattern = NotificationEvent.Checkpointer;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: ICheckpointerNotification,
  ): Promise<ICheckpointerEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);

    // Create enriched checkpointer notification
    const enrichedNotification: ICheckpointerEnrichedNotification = {
      ...event,
      type: EnrichedNotificationEvent.Checkpointer,
      ownerId,
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
