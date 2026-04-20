import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { EntityUUIDDto } from '../../../utils/dto/misc.dto';
import {
  GetRuntimesQueryDto,
  RuntimeHealthDto,
  RuntimeInstanceDto,
  RuntimeInstanceStateDto,
} from '../dto/runtime.dto';
import { RuntimeType } from '../runtime.types';
import { RuntimeService } from '../services/runtime.service';

@ApiTags('runtimes')
@Controller('runtimes')
@ApiBearerAuth()
@OnlyForAuthorized()
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Get('health')
  async checkHealth(): Promise<RuntimeHealthDto> {
    return await this.runtimeService.checkHealth(RuntimeType.Daytona);
  }

  @Get()
  async getRuntimes(
    @Query() query: GetRuntimesQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<RuntimeInstanceDto[]> {
    return await this.runtimeService.getRuntimesForThread(ctx, query);
  }

  @Get(':id/state')
  async getRuntimeState(
    @Param() { id }: EntityUUIDDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<RuntimeInstanceStateDto> {
    return await this.runtimeService.getRuntimeState(ctx, id);
  }
}
