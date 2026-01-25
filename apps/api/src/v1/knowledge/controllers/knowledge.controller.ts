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
  KnowledgeDocDto,
  KnowledgeDocInputDto,
  KnowledgeDocListQueryDto,
} from '../dto/knowledge.dto';
import { KnowledgeService } from '../services/knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge-docs')
@ApiBearerAuth()
@OnlyForAuthorized()
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async createDoc(@Body() dto: KnowledgeDocInputDto): Promise<KnowledgeDocDto> {
    return this.knowledgeService.createDoc(dto);
  }

  @Put(':id')
  async updateDoc(
    @Param() params: EntityUUIDDto,
    @Body() dto: KnowledgeDocInputDto,
  ): Promise<KnowledgeDocDto> {
    return this.knowledgeService.updateDoc(params.id, dto);
  }

  @Delete(':id')
  async deleteDoc(@Param() params: EntityUUIDDto): Promise<void> {
    return this.knowledgeService.deleteDoc(params.id);
  }

  @Get()
  async listDocs(
    @Query() query: KnowledgeDocListQueryDto,
  ): Promise<KnowledgeDocDto[]> {
    return this.knowledgeService.listDocs(query);
  }

  @Get(':id')
  async getDoc(@Param() params: EntityUUIDDto): Promise<KnowledgeDocDto> {
    return this.knowledgeService.getDoc(params.id);
  }
}
