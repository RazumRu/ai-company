import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IGraphNodeUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IGraphNodeUpdateEnrichedNotification extends IEnrichedNotification<
  IGraphNodeUpdateNotification['data']
> {
  type: NotificationEvent.GraphNodeUpdate;
  nodeId: string;
}

@Injectable()
export class GraphNodeUpdateNotificationHandler extends BaseNotificationHandler<IGraphNodeUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.GraphNodeUpdate;

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IGraphNodeUpdateNotification,
  ): Promise<IGraphNodeUpdateEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(this.graphDao, event.graphId);

    return [
      {
        type: NotificationEvent.GraphNodeUpdate,
        graphId: event.graphId,
        ownerId,
        nodeId: event.nodeId,
        threadId: event.threadId,
        runId: event.runId,
        scope: [NotificationScope.Graph],
        data: event.data,
      },
    ];
  }
}
