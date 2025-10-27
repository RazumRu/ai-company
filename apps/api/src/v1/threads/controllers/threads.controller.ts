import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import {
  GetMessagesQueryDto,
  GetThreadsQueryDto,
  ThreadDto,
  ThreadMessageDto,
} from '../dto/threads.dto';
import { ThreadsService } from '../services/threads.service';

@ApiTags('threads')
@Controller('threads')
@ApiBearerAuth()
@OnlyForAuthorized()
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  @Get()
  async getThreads(@Query() query: GetThreadsQueryDto): Promise<ThreadDto[]> {
    return this.threadsService.getThreads(query);
  }

  @Get(':threadId')
  async getThreadById(@Param('threadId') threadId: string): Promise<ThreadDto> {
    return this.threadsService.getThreadById(threadId);
  }

  @Get('external/:externalThreadId')
  async getThreadByExternalId(
    @Param('externalThreadId') externalThreadId: string,
  ): Promise<ThreadDto> {
    return this.threadsService.getThreadByExternalId(externalThreadId);
  }

  @Get(':threadId/messages')
  async getThreadMessages(
    @Param('threadId') threadId: string,
    @Query() query: GetMessagesQueryDto,
  ): Promise<ThreadMessageDto[]> {
    return this.threadsService.getThreadMessages(threadId, query);
  }
}
