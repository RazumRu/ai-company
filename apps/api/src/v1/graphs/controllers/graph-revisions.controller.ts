import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

import { EntityUUIDDto } from '../../../utils/dto/misc.dto';
import {
  GraphRevisionDto,
  GraphRevisionQueryDto,
} from '../dto/graph-revisions.dto';
import { GraphRevisionService } from '../services/graph-revision.service';

@Controller('graphs/:graphId/revisions')
@ApiTags('graph-revisions')
@ApiBearerAuth()
@OnlyForAuthorized()
export class GraphRevisionsController {
  constructor(private readonly graphRevisionService: GraphRevisionService) {}

  @Get()
  async getGraphRevisions(
    @Param('graphId') graphId: string,
    @Query() query: GraphRevisionQueryDto,
  ): Promise<GraphRevisionDto[]> {
    return await this.graphRevisionService.getRevisions(graphId, query);
  }

  @Get(':id')
  async getGraphRevision(
    @Param('graphId') graphId: string,
    @Param() params: EntityUUIDDto,
  ): Promise<GraphRevisionDto> {
    return await this.graphRevisionService.getRevisionById(graphId, params.id);
  }
}
