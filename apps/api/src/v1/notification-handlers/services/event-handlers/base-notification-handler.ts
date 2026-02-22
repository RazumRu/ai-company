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

  private readonly graphOwnerCache = new Map<string, string>();

  /**
   * Resolves the owner (createdBy) of a graph, caching results for the
   * lifetime of the handler instance to avoid repeated DB lookups during
   * high-frequency notification bursts for the same graph.
   */
  protected async getGraphOwner(
    graphDao: GraphDao,
    graphId: string,
  ): Promise<string> {
    const cached = this.graphOwnerCache.get(graphId);
    if (cached) {
      return cached;
    }

    const graph = await graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    this.graphOwnerCache.set(graphId, graph.createdBy);

    return graph.createdBy;
  }
}
