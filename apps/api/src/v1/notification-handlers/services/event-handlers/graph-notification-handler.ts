import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IGraphNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IGraphEnrichedNotification extends IEnrichedNotification<
  IGraphNotification['data']
> {
  type: NotificationEvent.Graph;
}

@Injectable()
export class GraphNotificationHandler extends BaseNotificationHandler<IGraphEnrichedNotification> {
  readonly pattern = NotificationEvent.Graph;

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IGraphNotification,
  ): Promise<IGraphEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(this.graphDao, event.graphId);

    // Create enriched graph notification
    const enrichedNotification: IGraphEnrichedNotification = {
      ...event,
      type: NotificationEvent.Graph,
      ownerId,
      scope: [NotificationScope.Graph],
    };

    return [enrichedNotification];
  }
}
