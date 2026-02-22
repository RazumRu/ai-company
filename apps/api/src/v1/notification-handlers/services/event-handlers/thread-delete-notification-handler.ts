import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
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

export interface IThreadDeleteEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: NotificationEvent.ThreadDelete;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadDeleteNotificationHandler extends BaseNotificationHandler<IThreadDeleteEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadDelete;

  constructor(
    private readonly graphDao: GraphDao,
    private readonly threadsService: ThreadsService,
  ) {
    super();
  }

  async handle(
    event: IThreadDeleteNotification,
  ): Promise<IThreadDeleteEnrichedNotification[]> {
    const { graphId, threadId, data } = event;

    const ownerId = await this.getGraphOwner(this.graphDao, graphId);

    const threadDto = this.threadsService.prepareThreadResponse(data);

    return [
      {
        type: NotificationEvent.ThreadDelete,
        graphId,
        ownerId,
        threadId,
        internalThreadId: threadDto.id,
        scope: [NotificationScope.Graph],
        data: threadDto,
      },
    ];
  }
}
