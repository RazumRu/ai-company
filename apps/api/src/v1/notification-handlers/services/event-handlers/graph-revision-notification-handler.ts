import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphRevisionDto } from '../../../graphs/dto/graph-revisions.dto';
import { GraphRevisionService } from '../../../graphs/services/graph-revision.service';
import {
  IGraphRevisionNotification,
  Notification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export type IGraphRevisionEnrichedNotification =
  IEnrichedNotification<GraphRevisionDto>;

@Injectable()
export class GraphRevisionNotificationHandler extends BaseNotificationHandler<IGraphRevisionEnrichedNotification> {
  pattern = [
    NotificationEvent.GraphRevisionCreate,
    NotificationEvent.GraphRevisionApplying,
    NotificationEvent.GraphRevisionApplied,
    NotificationEvent.GraphRevisionFailed,
  ];

  constructor(
    private readonly graphDao: GraphDao,
    private readonly logger: DefaultLogger,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async handle(
    event: Notification,
  ): Promise<IGraphRevisionEnrichedNotification[]> {
    try {
      const notification = event as IGraphRevisionNotification;
      const { graphId, data } = notification;

      const graph = await this.graphDao.getById(graphId);
      if (!graph) {
        this.logger.warn(
          `Graph ${graphId} not found for revision notification`,
        );
        return [];
      }

      // Convert entity to DTO
      const graphRevisionService =
        await this.moduleRef.create(GraphRevisionService);
      const revisionDto = graphRevisionService.prepareResponse(data);

      // Map NotificationEvent to EnrichedNotificationEvent
      let enrichedType: EnrichedNotificationEvent;
      switch (notification.type) {
        case NotificationEvent.GraphRevisionCreate:
          enrichedType = EnrichedNotificationEvent.GraphRevisionCreate;
          break;
        case NotificationEvent.GraphRevisionApplying:
          enrichedType = EnrichedNotificationEvent.GraphRevisionApplying;
          break;
        case NotificationEvent.GraphRevisionApplied:
          enrichedType = EnrichedNotificationEvent.GraphRevisionApplied;
          break;
        case NotificationEvent.GraphRevisionFailed:
          enrichedType = EnrichedNotificationEvent.GraphRevisionFailed;
          break;
        default:
          enrichedType = EnrichedNotificationEvent.Graph;
      }

      return [
        {
          type: enrichedType,
          data: revisionDto,
          graphId: notification.graphId,
          ownerId: graph.createdBy,
          scope: [NotificationScope.Graph, NotificationScope.User],
        },
      ];
    } catch (error) {
      this.logger.error(
        error as Error,
        `[GraphRevisionHandler] Failed to handle revision notification`,
      );
      return [];
    }
  }
}
