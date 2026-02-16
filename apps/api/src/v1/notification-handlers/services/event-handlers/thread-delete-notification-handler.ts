import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IThreadDeleteNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadsService } from '../../../threads/services/threads.service';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IThreadDeleteEnrichedNotification extends IEnrichedNotification<ThreadDto> {
  type: EnrichedNotificationEvent.ThreadDelete;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadDeleteNotificationHandler extends BaseNotificationHandler<IThreadDeleteEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadDelete;

  constructor(
    private readonly graphDao: GraphDao,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async handle(
    event: IThreadDeleteNotification,
  ): Promise<IThreadDeleteEnrichedNotification[]> {
    const { graphId, threadId, data } = event;

    const ownerId = await this.getGraphOwner(graphId);
    const threadsService = await this.moduleRef.create(ThreadsService);

    const threadDto = threadsService.prepareThreadResponse(data);

    return [
      {
        type: EnrichedNotificationEvent.ThreadDelete,
        graphId,
        ownerId,
        threadId,
        internalThreadId: threadDto.id,
        scope: [NotificationScope.Graph],
        data: threadDto,
      },
    ];
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    const graph = await this.graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    return graph.createdBy;
  }
}
