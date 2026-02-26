import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IThreadCreateNotification,
  IThreadDeleteNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadsService } from '../../../threads/services/threads.service';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

type ThreadLifecycleNotification =
  | IThreadCreateNotification
  | IThreadDeleteNotification;

export interface IThreadLifecycleEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: NotificationEvent.ThreadCreate | NotificationEvent.ThreadDelete;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadLifecycleNotificationHandler extends BaseNotificationHandler<IThreadLifecycleEnrichedNotification> {
  readonly pattern = [
    NotificationEvent.ThreadCreate,
    NotificationEvent.ThreadDelete,
  ];

  constructor(
    private readonly graphDao: GraphDao,
    private readonly threadsService: ThreadsService,
  ) {
    super();
  }

  async handle(
    event: ThreadLifecycleNotification,
  ): Promise<IThreadLifecycleEnrichedNotification[]> {
    const { graphId, threadId, data } = event;

    const { ownerId, projectId } = await this.getGraphInfo(this.graphDao, graphId);

    const threadDto = this.threadsService.prepareThreadResponse(data);

    return [
      {
        type: event.type,
        graphId,
        projectId,
        ownerId,
        threadId,
        internalThreadId: threadDto.id,
        scope: [NotificationScope.Graph],
        data: threadDto,
      },
    ];
  }
}
