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
import {
  AuthContextStorage,
  CtxStorage,
  OnlyForAuthorized,
} from '@packages/http-server';

import { EntityUUIDDto } from '../../../utils/dto/misc.dto';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GetAllGraphsQueryDto,
  GraphDto,
  GraphNodesQueryDto,
  GraphNodeWithStatusDto,
  UpdateGraphDto,
  UpdateGraphResponseDto,
} from '../dto/graphs.dto';
import { GraphsService } from '../services/graphs.service';

@Controller('graphs')
@ApiTags('graphs')
@ApiBearerAuth()
@OnlyForAuthorized()
export class GraphsController {
  constructor(private readonly graphsService: GraphsService) {}

  @Post()
  async createGraph(
    @Body() dto: CreateGraphDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphDto> {
    return await this.graphsService.create(contextDataStorage, dto);
  }

  @Get()
  async getAllGraphs(
    @Query() query: GetAllGraphsQueryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphDto[]> {
    return await this.graphsService.getAll(contextDataStorage, query);
  }

  @Get(':id')
  async findGraphById(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphDto> {
    return await this.graphsService.findById(contextDataStorage, params.id);
  }

  @Get(':id/nodes')
  async getCompiledNodes(
    @Param() params: EntityUUIDDto,
    @Query() query: GraphNodesQueryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphNodeWithStatusDto[]> {
    return this.graphsService.getCompiledNodes(
      contextDataStorage,
      params.id,
      query,
    );
  }

  @Put(':id')
  async updateGraph(
    @Param() params: EntityUUIDDto,
    @Body() dto: UpdateGraphDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<UpdateGraphResponseDto> {
    return await this.graphsService.update(contextDataStorage, params.id, dto);
  }

  @Delete(':id')
  async deleteGraph(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<void> {
    await this.graphsService.delete(contextDataStorage, params.id);
  }

  @Post(':id/run')
  async runGraph(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphDto> {
    return await this.graphsService.run(contextDataStorage, params.id);
  }

  @Post(':id/destroy')
  async destroyGraph(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GraphDto> {
    return await this.graphsService.destroy(contextDataStorage, params.id);
  }

  @Post(':graphId/triggers/:triggerId/execute')
  async executeTrigger(
    @Param('graphId') graphId: string,
    @Param('triggerId') triggerId: string,
    @Body() payload: ExecuteTriggerDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<ExecuteTriggerResponseDto> {
    return await this.graphsService.executeTrigger(
      contextDataStorage,
      graphId,
      triggerId,
      payload,
    );
  }
}
