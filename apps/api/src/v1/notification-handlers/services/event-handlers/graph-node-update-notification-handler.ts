import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IGraphNodeUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IGraphNodeUpdateEnrichedNotification extends IEnrichedNotification<
  IGraphNodeUpdateNotification['data']
> {
  type: EnrichedNotificationEvent.GraphNodeUpdate;
  nodeId: string;
}

@Injectable()
export class GraphNodeUpdateNotificationHandler extends BaseNotificationHandler<IGraphNodeUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.GraphNodeUpdate;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: IGraphNodeUpdateNotification,
  ): Promise<IGraphNodeUpdateEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);

    return [
      {
        type: EnrichedNotificationEvent.GraphNodeUpdate,
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

  private async getGraphOwner(graphId: string): Promise<string> {
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }

    const graph = await this.graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    this.graphOwnerCache.set(graphId, graph.createdBy);

    return graph.createdBy;
  }
}
