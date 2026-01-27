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
  async createGraph(@Body() dto: CreateGraphDto): Promise<GraphDto> {
    return await this.graphsService.create(dto);
  }

  @Get()
  async getAllGraphs(
    @Query() query: GetAllGraphsQueryDto,
  ): Promise<GraphDto[]> {
    return await this.graphsService.getAll(query);
  }

  @Get(':id')
  async findGraphById(@Param() params: EntityUUIDDto): Promise<GraphDto> {
    return await this.graphsService.findById(params.id);
  }

  @Get(':id/nodes')
  async getCompiledNodes(
    @Param() params: EntityUUIDDto,
    @Query() query: GraphNodesQueryDto,
  ): Promise<GraphNodeWithStatusDto[]> {
    return this.graphsService.getCompiledNodes(params.id, query);
  }

  @Put(':id')
  async updateGraph(
    @Param() params: EntityUUIDDto,
    @Body() dto: UpdateGraphDto,
  ): Promise<UpdateGraphResponseDto> {
    return await this.graphsService.update(params.id, dto);
  }

  @Delete(':id')
  async deleteGraph(@Param() params: EntityUUIDDto): Promise<void> {
    await this.graphsService.delete(params.id);
  }

  @Post(':id/run')
  async runGraph(@Param() params: EntityUUIDDto): Promise<GraphDto> {
    return await this.graphsService.run(params.id);
  }

  @Post(':id/destroy')
  async destroyGraph(@Param() params: EntityUUIDDto): Promise<GraphDto> {
    return await this.graphsService.destroy(params.id);
  }

  @Post(':graphId/triggers/:triggerId/execute')
  async executeTrigger(
    @Param('graphId') graphId: string,
    @Param('triggerId') triggerId: string,
    @Body() payload: ExecuteTriggerDto,
  ): Promise<ExecuteTriggerResponseDto> {
    return await this.graphsService.executeTrigger(graphId, triggerId, payload);
  }
}
