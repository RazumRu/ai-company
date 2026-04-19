import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotFoundException } from '@packages/common';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';
import {
  ListEntriesQueryDto,
  NamespaceSummaryDto,
  ThreadStoreEntryDto,
} from '../dto/thread-store.dto';
import { ThreadStoreService } from '../services/thread-store.service';

@ApiTags('thread-store')
@Controller('threads/:threadId/store')
@ApiBearerAuth()
@OnlyForAuthorized()
export class ThreadStoreController {
  constructor(private readonly threadStoreService: ThreadStoreService) {}

  @Get()
  async listNamespaces(
    @Param('threadId') threadId: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<NamespaceSummaryDto[]> {
    return this.threadStoreService.listNamespaces(ctx, threadId);
  }

  @Get(':namespace')
  async listEntries(
    @Param('threadId') threadId: string,
    @Param('namespace') namespace: string,
    @Query() query: ListEntriesQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadStoreEntryDto[]> {
    return this.threadStoreService.listEntries(ctx, threadId, namespace, query);
  }

  @Get(':namespace/:key')
  async getEntry(
    @Param('threadId') threadId: string,
    @Param('namespace') namespace: string,
    @Param('key') key: string,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ThreadStoreEntryDto> {
    const entry = await this.threadStoreService.get(
      ctx,
      threadId,
      namespace,
      key,
    );
    if (!entry) {
      throw new NotFoundException('THREAD_STORE_ENTRY_NOT_FOUND');
    }
    return entry;
  }
}
