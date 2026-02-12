import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import {
  GetMessagesQueryDto,
  GetThreadsQueryDto,
  SetThreadMetadataDto,
  ThreadDto,
  ThreadMessageDto,
  ThreadUsageStatisticsDto,
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

  @Get(':threadId/usage-statistics')
  async getThreadUsageStatistics(
    @Param('threadId') threadId: string,
  ): Promise<ThreadUsageStatisticsDto> {
    return this.threadsService.getThreadUsageStatistics(threadId);
  }

  @Put(':threadId/metadata')
  async setThreadMetadata(
    @Param('threadId') threadId: string,
    @Body() dto: SetThreadMetadataDto,
  ): Promise<ThreadDto> {
    return this.threadsService.setMetadata(threadId, dto);
  }

  @Put('external/:externalThreadId/metadata')
  async setThreadMetadataByExternalId(
    @Param('externalThreadId') externalThreadId: string,
    @Body() dto: SetThreadMetadataDto,
  ): Promise<ThreadDto> {
    return this.threadsService.setMetadataByExternalId(externalThreadId, dto);
  }

  @Delete(':threadId')
  async deleteThread(@Param('threadId') threadId: string): Promise<void> {
    return this.threadsService.deleteThread(threadId);
  }

  @Post(':threadId/stop')
  async stopThread(@Param('threadId') threadId: string): Promise<ThreadDto> {
    return this.threadsService.stopThread(threadId);
  }

  @Post('external/:externalThreadId/stop')
  async stopThreadByExternalId(
    @Param('externalThreadId') externalThreadId: string,
  ): Promise<ThreadDto> {
    return this.threadsService.stopThreadByExternalId(externalThreadId);
  }
}
