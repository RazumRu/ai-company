import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { NotificationEvent } from '../../../notifications/notifications.types';
import { Notification } from '../../../notifications/notifications.types';
import { IEnrichedNotification } from '../../notification-handlers.types';

export abstract class BaseNotificationHandler<
  T extends IEnrichedNotification<unknown> = IEnrichedNotification<unknown>,
> {
  abstract readonly pattern: NotificationEvent | NotificationEvent[];

  abstract handle(event: Notification): Promise<T[]>;

  private readonly graphInfoCache = new Map<
    string,
    { ownerId: string; projectId: string }
  >();

  /**
   * Resolves the owner (createdBy) and projectId of a graph, caching results for the
   * lifetime of the handler instance to avoid repeated DB lookups during
   * high-frequency notification bursts for the same graph.
   */
  protected async getGraphInfo(
    graphDao: GraphDao,
    graphId: string,
  ): Promise<{ ownerId: string; projectId: string }> {
    const cached = this.graphInfoCache.get(graphId);
    if (cached) {
      return cached;
    }

    const graph = await graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException(
        'GRAPH_NOT_FOUND',
        `Graph ${graphId} not found`,
      );
    }

    if (!graph.projectId) {
      throw new NotFoundException('GRAPH_PROJECT_NOT_SET');
    }

    const info = { ownerId: graph.createdBy, projectId: graph.projectId };
    this.graphInfoCache.set(graphId, info);
    return info;
  }

  protected async getGraphOwner(
    graphDao: GraphDao,
    graphId: string,
  ): Promise<string> {
    return (await this.getGraphInfo(graphDao, graphId)).ownerId;
  }
}
