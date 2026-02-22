import { Injectable } from '@nestjs/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IThreadCreateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadsService } from '../../../threads/services/threads.service';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IThreadCreateEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: NotificationEvent.ThreadCreate;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadCreateNotificationHandler extends BaseNotificationHandler<IThreadCreateEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadCreate;

  constructor(
    private readonly graphDao: GraphDao,
    private readonly threadsService: ThreadsService,
  ) {
    super();
  }

  async handle(
    event: IThreadCreateNotification,
  ): Promise<IThreadCreateEnrichedNotification[]> {
    const { graphId, threadId, data } = event;

    const ownerId = await this.getGraphOwner(this.graphDao, graphId);

    const threadDto = this.threadsService.prepareThreadResponse(data);

    return [
      {
        type: NotificationEvent.ThreadCreate,
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
