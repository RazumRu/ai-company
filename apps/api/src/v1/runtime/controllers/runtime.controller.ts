import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthContextStorage,
  CtxStorage,
  OnlyForAuthorized,
} from '@packages/http-server';

import {
  GetRuntimesQueryDto,
  RuntimeInstanceDto,
} from '../dto/runtime.dto';
import { RuntimeService } from '../services/runtime.service';

@ApiTags('runtimes')
@Controller('runtimes')
@ApiBearerAuth()
@OnlyForAuthorized()
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Get()
  async getRuntimes(
    @Query() query: GetRuntimesQueryDto,
    @CtxStorage() ctx: AuthContextStorage,
  ): Promise<RuntimeInstanceDto[]> {
    return this.runtimeService.getRuntimesForThread(ctx, query);
  }
}
