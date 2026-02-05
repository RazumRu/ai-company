import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthContextStorage,
  CtxStorage,
  OnlyForAuthorized,
} from '@packages/http-server';

import {
  CreateRepositoryDto,
  GetRepoIndexesQueryDto,
  GetRepositoriesQueryDto,
  GitRepositoryDto,
  RepoIndexDto,
  TriggerReindexDto,
  TriggerReindexResponseDto,
  UpdateRepositoryDto,
} from '../dto/git-repositories.dto';
import { GitRepositoriesService } from '../services/git-repositories.service';
import { RepoIndexService } from '../services/repo-index.service';

@ApiTags('git-repositories')
@Controller('git-repositories')
@ApiBearerAuth()
@OnlyForAuthorized()
export class GitRepositoriesController {
  constructor(
    private readonly gitRepositoriesService: GitRepositoriesService,
    private readonly repoIndexService: RepoIndexService,
  ) {}

  @Post()
  async createRepository(
    @Body() dto: CreateRepositoryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GitRepositoryDto> {
    return this.gitRepositoriesService.createRepository(
      contextDataStorage,
      dto,
    );
  }

  @Get()
  async getRepositories(
    @Query() query: GetRepositoriesQueryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GitRepositoryDto[]> {
    return this.gitRepositoriesService.getRepositories(
      contextDataStorage,
      query,
    );
  }

  @Get(':id')
  async getRepositoryById(
    @Param('id') id: string,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GitRepositoryDto> {
    return this.gitRepositoriesService.getRepositoryById(
      contextDataStorage,
      id,
    );
  }

  @Patch(':id')
  async updateRepository(
    @Param('id') id: string,
    @Body() dto: UpdateRepositoryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<GitRepositoryDto> {
    return this.gitRepositoriesService.updateRepository(
      contextDataStorage,
      id,
      dto,
    );
  }

  @Delete(':id')
  async deleteRepository(
    @Param('id') id: string,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<void> {
    return this.gitRepositoriesService.deleteRepository(contextDataStorage, id);
  }

  @Get('indexes')
  async getRepoIndexes(
    @Query() query: GetRepoIndexesQueryDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<RepoIndexDto[]> {
    return this.gitRepositoriesService.getRepoIndexes(
      contextDataStorage,
      query,
    );
  }

  @Get(':id/index')
  async getRepoIndexByRepositoryId(
    @Param('id') id: string,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<RepoIndexDto | null> {
    return this.gitRepositoriesService.getRepoIndexByRepositoryId(
      contextDataStorage,
      id,
    );
  }

  @Post('reindex')
  async triggerReindex(
    @Body() dto: TriggerReindexDto,
    @CtxStorage() contextDataStorage: AuthContextStorage,
  ): Promise<TriggerReindexResponseDto> {
    return this.gitRepositoriesService.triggerReindex(contextDataStorage, dto);
  }
}
