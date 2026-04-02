import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';
import {
  GetMessagesQueryDto,
  GetThreadsQueryDto,
  ResumeThreadDto,
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
  async getThreads(
    @Query() query: GetThreadsQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto[]> {
    return this.threadsService.getThreads(ctx, query);
  }

  @Get(':threadId')
  async getThreadById(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.getThreadById(ctx, threadId);
  }

  @Get('external/:externalThreadId')
  async getThreadByExternalId(
    @Param('externalThreadId') externalThreadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.getThreadByExternalId(ctx, externalThreadId);
  }

  @Get(':threadId/messages')
  async getThreadMessages(
    @Param('threadId') threadId: string,
    @Query() query: GetMessagesQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadMessageDto[]> {
    return this.threadsService.getThreadMessages(ctx, threadId, query);
  }

  @Get(':threadId/usage-statistics')
  async getThreadUsageStatistics(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadUsageStatisticsDto> {
    return this.threadsService.getThreadUsageStatistics(ctx, threadId);
  }

  @Get(':threadId/export')
  async exportThread(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<StreamableFile> {
    return this.threadsService.getThreadExportFile(ctx, threadId);
  }

  @Put(':threadId/metadata')
  async setThreadMetadata(
    @Param('threadId') threadId: string,
    @Body() dto: SetThreadMetadataDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.setMetadata(ctx, threadId, dto);
  }

  @Put('external/:externalThreadId/metadata')
  async setThreadMetadataByExternalId(
    @Param('externalThreadId') externalThreadId: string,
    @Body() dto: SetThreadMetadataDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.setMetadataByExternalId(
      ctx,
      externalThreadId,
      dto,
    );
  }

  @Delete(':threadId')
  async deleteThread(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<void> {
    return this.threadsService.deleteThread(ctx, threadId);
  }

  @Post(':threadId/stop')
  async stopThread(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.stopThread(ctx, threadId);
  }

  @Post('external/:externalThreadId/stop')
  async stopThreadByExternalId(
    @Param('externalThreadId') externalThreadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.stopThreadByExternalId(ctx, externalThreadId);
  }

  @Post(':threadId/resume')
  async resumeThread(
    @Param('threadId') threadId: string,
    @Body() dto: ResumeThreadDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.resumeThread(ctx, threadId, dto);
  }

  @Post(':threadId/cancel-wait')
  async cancelWait(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadDto> {
    return this.threadsService.cancelWait(ctx, threadId);
  }
}
