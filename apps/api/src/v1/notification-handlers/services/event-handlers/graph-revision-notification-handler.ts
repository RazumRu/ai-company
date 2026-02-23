import { Injectable } from '@nestjs/common';
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
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export type IGraphRevisionEnrichedNotification =
  | IEnrichedNotification<GraphRevisionDto>
  | IEnrichedNotification<IGraphRevisionProgressData>;

@Injectable()
export class GraphRevisionNotificationHandler extends BaseNotificationHandler<IGraphRevisionEnrichedNotification> {
  readonly pattern = [
    NotificationEvent.GraphRevisionCreate,
    NotificationEvent.GraphRevisionApplying,
    NotificationEvent.GraphRevisionApplied,
    NotificationEvent.GraphRevisionFailed,
    NotificationEvent.GraphRevisionProgress,
  ];

  constructor(
    private readonly graphDao: GraphDao,
    private readonly logger: DefaultLogger,
    private readonly graphRevisionService: GraphRevisionService,
  ) {
    super();
  }

  async handle(
    event: Notification,
  ): Promise<IGraphRevisionEnrichedNotification[]> {
    try {
      // Progress events use a different data shape and don't need prepareResponse
      //
      // NOTE: This handler uses graphDao.getById() directly instead of the shared
      // getGraphOwner() from BaseNotificationHandler because revision notifications
      // have different error semantics: a missing graph returns [] (graceful skip)
      // rather than throwing NotFoundException, and getById is used instead of getOne.
      if (event.type === NotificationEvent.GraphRevisionProgress) {
        const progressNotification =
          event as IGraphRevisionProgressNotification;
        const graph = await this.graphDao.getById(progressNotification.graphId);
        if (!graph) {
          this.logger.warn(
            `Graph ${progressNotification.graphId} not found for ${progressNotification.type} notification — skipping`,
          );
          return [];
        }
        return [
          {
            type: NotificationEvent.GraphRevisionProgress,
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
          `Graph ${graphId} not found for ${notification.type} notification — skipping`,
        );
        return [];
      }

      const revisionDto = this.graphRevisionService.prepareResponse(data);

      return [
        {
          type: notification.type,
          data: revisionDto,
          graphId: notification.graphId,
          ownerId: graph.createdBy,
          scope: [NotificationScope.Graph, NotificationScope.User],
        },
      ];
    } catch (error) {
      this.logger.error(
        error as Error,
        `[GraphRevisionHandler] Failed to handle ${event.type} notification for graph ${event.graphId}`,
      );
      return [];
    }
  }
}
