import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  GetGraphMessagesQueryDto,
  GraphDto,
  GraphMessagesResponseDto,
  UpdateGraphDto,
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
  async getAllGraphs(): Promise<GraphDto[]> {
    return await this.graphsService.getAll();
  }

  @Get(':id')
  async findGraphById(@Param() params: EntityUUIDDto): Promise<GraphDto> {
    return await this.graphsService.findById(params.id);
  }

  @Put(':id')
  async updateGraph(
    @Param() params: EntityUUIDDto,
    @Body() dto: UpdateGraphDto,
  ): Promise<GraphDto> {
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async executeTrigger(
    @Param('graphId') graphId: string,
    @Param('triggerId') triggerId: string,
    @Body() payload: ExecuteTriggerDto,
  ): Promise<void> {
    await this.graphsService.executeTrigger(graphId, triggerId, payload);
  }

  @Get(':graphId/nodes/:nodeId/messages')
  async getNodeMessages(
    @Param('graphId') graphId: string,
    @Param('nodeId') nodeId: string,
    @Query() query: GetGraphMessagesQueryDto,
  ): Promise<GraphMessagesResponseDto> {
    return await this.graphsService.getNodeMessages(graphId, nodeId, query);
  }
}
