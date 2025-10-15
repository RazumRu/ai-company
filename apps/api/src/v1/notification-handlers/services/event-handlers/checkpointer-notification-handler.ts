import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageDto } from '../../../graphs/dto/graphs.dto';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import {
  ICheckpointerNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface ICheckpointerEnrichedNotification
  extends IEnrichedNotification<MessageDto> {
  type: EnrichedNotificationEvent.CheckpointerMessage;
  nodeId: string;
  threadId: string;
}

@Injectable()
export class CheckpointerNotificationHandler extends BaseNotificationHandler<ICheckpointerEnrichedNotification> {
  readonly pattern = NotificationEvent.Checkpointer;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(
    private readonly graphDao: GraphDao,
    private readonly messageTransformer: MessageTransformerService,
  ) {
    super();
  }

  async handle(
    event: ICheckpointerNotification,
  ): Promise<ICheckpointerEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);
    const out: ICheckpointerEnrichedNotification[] = [];

    // Transform BaseMessage array (already extracted in pg-checkpoint-saver)
    const messageDtos = this.messageTransformer.transformMessagesToDto(
      event.data.messages,
    );

    for (const messageDto of messageDtos) {
      out.push({
        type: EnrichedNotificationEvent.CheckpointerMessage,
        graphId: event.graphId,
        ownerId,
        nodeId: event.nodeId,
        threadId: event.threadId,
        data: messageDto,
      });
    }

    return out;
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }
    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }
    this.graphOwnerCache.set(graphId, graph.createdBy);
    return graph.createdBy;
  }
}
