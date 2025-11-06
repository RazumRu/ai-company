import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphsService } from '../../../graphs/services/graphs.service';
import {
  IThreadCreateNotification,
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

export interface IThreadCreateEnrichedNotification
  extends IEnrichedNotification<ThreadDto> {
  type: EnrichedNotificationEvent.ThreadCreate;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class ThreadCreateNotificationHandler extends BaseNotificationHandler<IThreadCreateEnrichedNotification> {
  readonly pattern = NotificationEvent.ThreadCreate;

  constructor(
    private readonly graphDao: GraphDao,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  async handle(
    event: IThreadCreateNotification,
  ): Promise<IThreadCreateEnrichedNotification[]> {
    const { graphId, threadId, data } = event;

    const ownerId = await this.getGraphOwner(graphId);

    const threadsService = await this.moduleRef.create(ThreadsService);
    const threadDto = threadsService.prepareThreadResponse(data);

    return [
      {
        type: EnrichedNotificationEvent.ThreadCreate,
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
