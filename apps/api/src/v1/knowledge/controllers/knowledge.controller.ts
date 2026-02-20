import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  KnowledgeDocCreateDto,
  KnowledgeDocDto,
  KnowledgeDocListQueryDto,
  KnowledgeDocUpdateDto,
} from '../dto/knowledge.dto';
import {
  KnowledgeDocListResult,
  KnowledgeService,
} from '../services/knowledge.service';

@ApiTags('knowledge')
@Controller('knowledge-docs')
@ApiBearerAuth()
@OnlyForAuthorized()
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  async createDoc(
    @Body() dto: KnowledgeDocCreateDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<KnowledgeDocDto> {
    return this.knowledgeService.createDoc(contextDataStorage, dto);
  }

  @Put(':id')
  async updateDoc(
    @Param() params: EntityUUIDDto,
    @Body() dto: KnowledgeDocUpdateDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<KnowledgeDocDto> {
    return this.knowledgeService.updateDoc(contextDataStorage, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteDoc(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<void> {
    await this.knowledgeService.deleteDoc(contextDataStorage, params.id);
  }

  @Get()
  async listDocs(
    @Query() query: KnowledgeDocListQueryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<KnowledgeDocListResult> {
    return this.knowledgeService.listDocs(contextDataStorage, query);
  }

  @Get(':id')
  async getDoc(
    @Param() params: EntityUUIDDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<KnowledgeDocDto> {
    return this.knowledgeService.getDoc(contextDataStorage, params.id);
  }
}
