import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DefaultLogger } from '@packages/common';

import type { GraphDeletedEvent } from '../graphs/graphs.events';
import { GRAPH_DELETED_EVENT } from '../graphs/graphs.events';
import { MessagesDao } from './dao/messages.dao';
import { ThreadsDao } from './dao/threads.dao';

@Injectable()
export class ThreadsListener {
  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly logger: DefaultLogger,
  ) {}

  @OnEvent(GRAPH_DELETED_EVENT)
  async onGraphDeleted(event: GraphDeletedEvent): Promise<void> {
    try {
      const threads = await this.threadsDao.getAll({
        graphId: event.graphId,
        createdBy: event.userId,
      });
      const threadIds = threads.map((t) => t.id);

      if (threadIds.length > 0) {
        this.logger.log(
          `Deleting ${threadIds.length} threads and their messages for graph ${event.graphId} by user ${event.userId}`,
        );
        await this.messagesDao.delete({ threadIds });
        await this.threadsDao.delete({
          graphId: event.graphId,
          createdBy: event.userId,
        });
      }
    } catch (error) {
      this.logger.error(
        error as Error,
        `Failed to delete threads for graph ${event.graphId} by user ${event.userId}`,
      );
      throw error;
    }
  }
}
