import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

import { MessagesDao } from '../dao/messages.dao';
import { ThreadsDao } from '../dao/threads.dao';
import {
  GetMessagesQueryDto,
  GetThreadsQueryDto,
  ThreadDto,
  ThreadMessageDto,
} from '../dto/threads.dto';
import { MessageEntity } from '../entity/message.entity';
import { ThreadEntity } from '../entity/thread.entity';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly authContext: AuthContextService,
  ) {}

  async getThreads(query: GetThreadsQueryDto): Promise<ThreadDto[]> {
    const userId = this.authContext.checkSub();

    const threads = await this.threadDao.getAll({
      createdBy: userId,
      ...query,
      order: { createdAt: 'DESC' },
    });

    return threads.map(this.prepareThreadResponse);
  }

  async getThreadById(threadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    return this.prepareThreadResponse(thread);
  }

  async getThreadByExternalId(externalThreadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      externalThreadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    return this.prepareThreadResponse(thread);
  }

  async getThreadMessages(
    threadId: string,
    query: GetMessagesQueryDto,
  ): Promise<ThreadMessageDto[]> {
    const userId = this.authContext.checkSub();

    // First verify the thread exists and belongs to the user
    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const messages = await this.messagesDao.getAll({
      threadId,
      ...query,
      order: { createdAt: 'ASC' },
    });

    return messages.map(this.prepareMessageResponse);
  }

  public prepareThreadResponse(entity: ThreadEntity): ThreadDto {
    const { deletedAt: _deletedAt, ...entityWithoutDeletedAt } = entity;
    return {
      ...entityWithoutDeletedAt,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
      metadata: entity.metadata || {},
    };
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    return {
      ...entity,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
