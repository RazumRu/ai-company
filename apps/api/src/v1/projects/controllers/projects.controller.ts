import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { EntityUUIDDto } from '../../../utils/dto/misc.dto';
import {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectDto,
} from '../dto/projects.dto';
import { ProjectsService } from '../services/projects.service';

@Controller('projects')
@ApiTags('projects')
@ApiBearerAuth()
@OnlyForAuthorized()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async createProject(
    @Body() dto: CreateProjectDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ProjectDto> {
    return await this.projectsService.create(ctx, dto);
  }

  @Get()
  async getAllProjects(
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ProjectDto[]> {
    return await this.projectsService.getAll(ctx);
  }

  @Get(':id')
  async findProjectById(
    @Param() params: EntityUUIDDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ProjectDto> {
    return await this.projectsService.findById(ctx, params.id);
  }

  @Put(':id')
  async updateProject(
    @Param() params: EntityUUIDDto,
    @Body() dto: UpdateProjectDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<ProjectDto> {
    return await this.projectsService.update(ctx, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteProject(
    @Param() params: EntityUUIDDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<void> {
    await this.projectsService.delete(ctx, params.id);
  }
}
