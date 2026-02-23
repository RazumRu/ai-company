import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentStateUpdateNotification,
  IGraphNodeUpdateNotification,
  IGraphNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export type SimpleNotification =
  | IGraphNotification
  | IGraphNodeUpdateNotification
  | IAgentStateUpdateNotification;

export type SimpleEnrichedNotification = IEnrichedNotification<
  SimpleNotification['data']
>;

@Injectable()
export class SimpleEnrichmentHandler extends BaseNotificationHandler<SimpleEnrichedNotification> {
  readonly pattern = [
    NotificationEvent.Graph,
    NotificationEvent.GraphNodeUpdate,
    NotificationEvent.AgentStateUpdate,
  ];

  constructor(private readonly graphDao: GraphDao) {
    super();
  }

  async handle(
    event: SimpleNotification,
  ): Promise<SimpleEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(this.graphDao, event.graphId);

    const threadId = this.resolveThreadId(event);

    return [
      {
        type: event.type,
        graphId: event.graphId,
        ownerId,
        nodeId: event.nodeId,
        threadId,
        runId: event.runId,
        scope: [NotificationScope.Graph],
        data: event.data,
      },
    ];
  }

  /**
   * Resolve the external thread ID for notifications that carry thread
   * context.  AgentStateUpdate prefers parentThreadId over threadId;
   * GraphNodeUpdate passes threadId through as-is.
   */
  private resolveThreadId(event: SimpleNotification): string | undefined {
    if (event.type === NotificationEvent.AgentStateUpdate) {
      return event.parentThreadId ?? event.threadId;
    }
    return event.threadId;
  }
}
