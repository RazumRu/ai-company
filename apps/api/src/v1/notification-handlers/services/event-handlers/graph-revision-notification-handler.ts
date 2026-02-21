import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphRevisionDto } from '../../../graphs/dto/graph-revisions.dto';
import { GraphRevisionService } from '../../../graphs/services/graph-revision.service';
import {
  IGraphRevisionNotification,
  IGraphRevisionProgressData,
  IGraphRevisionProgressNotification,
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
  | IEnrichedNotification<GraphRevisionDto>
  | IEnrichedNotification<IGraphRevisionProgressData>;

@Injectable()
export class GraphRevisionNotificationHandler extends BaseNotificationHandler<IGraphRevisionEnrichedNotification> {
  pattern = [
    NotificationEvent.GraphRevisionCreate,
    NotificationEvent.GraphRevisionApplying,
    NotificationEvent.GraphRevisionApplied,
    NotificationEvent.GraphRevisionFailed,
    NotificationEvent.GraphRevisionProgress,
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
      // Progress events use a different data shape and don't need prepareResponse
      if (event.type === NotificationEvent.GraphRevisionProgress) {
        const progressNotification =
          event as IGraphRevisionProgressNotification;
        const graph = await this.graphDao.getById(progressNotification.graphId);
        if (!graph) {
          return [];
        }
        return [
          {
            type: EnrichedNotificationEvent.GraphRevisionProgress,
            data: progressNotification.data,
            graphId: progressNotification.graphId,
            ownerId: graph.createdBy,
            scope: [NotificationScope.Graph],
          },
        ];
      }

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
      // Use resolve instead of create to look up from entire application context
      const graphRevisionService = await this.moduleRef.resolve(
        GraphRevisionService,
        undefined,
        { strict: false },
      );
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
