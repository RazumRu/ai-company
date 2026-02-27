import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { TypeormService } from '@packages/typeorm';
import { EntityManager } from 'typeorm';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GitRepositoriesDao } from '../../git-repositories/dao/git-repositories.dao';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { KnowledgeDocDao } from '../../knowledge/dao/knowledge-doc.dao';
import { ProjectsDao } from '../dao/projects.dao';
import { ProjectsStatsDao } from '../dao/projects-stats.dao';
import {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectDto,
} from '../dto/projects.dto';
import { ProjectEntity } from '../entity/project.entity';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsDao: ProjectsDao,
    private readonly projectsStatsDao: ProjectsStatsDao,
    private readonly typeorm: TypeormService,
    private readonly graphDao: GraphDao,
    private readonly knowledgeDocDao: KnowledgeDocDao,
    private readonly gitRepositoriesDao: GitRepositoriesDao,
  ) {}

  private prepareResponse(
    entity: ProjectEntity,
    stats: { graphCount: number; threadCount: number } = {
      graphCount: 0,
      threadCount: 0,
    },
  ): ProjectDto {
    return {
      ...entity,
      description: entity.description ?? null,
      icon: entity.icon ?? null,
      color: entity.color ?? null,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      graphCount: stats.graphCount,
      threadCount: stats.threadCount,
    };
  }

  async create(
    ctx: AppContextStorage,
    dto: CreateProjectDto,
  ): Promise<ProjectDto> {
    const userId = ctx.checkSub();

    return this.typeorm.trx(async (em: EntityManager) => {
      const project = await this.projectsDao.create(
        {
          name: dto.name,
          description: dto.description ?? null,
          icon: dto.icon ?? null,
          color: dto.color ?? null,
          settings: dto.settings ?? {},
          createdBy: userId,
        },
        em,
      );
      return this.prepareResponse(project);
    });
  }

  async getAll(ctx: AppContextStorage): Promise<ProjectDto[]> {
    const userId = ctx.checkSub();
    const rows = await this.projectsDao.getAll({
      createdBy: userId,
      order: { updatedAt: 'DESC' },
    });

    if (rows.length === 0) return [];

    const projectIds = rows.map((r) => r.id);
    const statsRows =
      await this.projectsStatsDao.countStatsByProjectIds(projectIds);
    const statsMap = new Map(
      statsRows.map((r) => [
        r.projectId,
        {
          graphCount: parseInt(r.graphCount, 10),
          threadCount: parseInt(r.threadCount, 10),
        },
      ]),
    );

    return rows.map((row) => this.prepareResponse(row, statsMap.get(row.id)));
  }

  async findById(ctx: AppContextStorage, id: string): Promise<ProjectDto> {
    const userId = ctx.checkSub();
    const project = await this.projectsDao.getOne({ id, createdBy: userId });
    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }
    return this.prepareResponse(project);
  }

  async update(
    ctx: AppContextStorage,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    const userId = ctx.checkSub();

    return this.typeorm.trx(async (em: EntityManager) => {
      const existing = await this.projectsDao.getOne({ id, createdBy: userId });
      if (!existing) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }

      const updated = await this.projectsDao.updateById(id, dto, em);
      if (!updated) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      return this.prepareResponse(updated);
    });
  }

  async delete(ctx: AppContextStorage, id: string): Promise<void> {
    const userId = ctx.checkSub();
    const project = await this.projectsDao.getOne({ id, createdBy: userId });
    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }

    // Cascade soft-delete children via their DAOs directly.
    // Including createdBy provides defense-in-depth: only rows owned by this
    // user are deleted, even though ownership was already verified above.
    await this.graphDao.delete({ projectId: id, createdBy: userId });
    await this.knowledgeDocDao.delete({ projectId: id, createdBy: userId });
    await this.gitRepositoriesDao.delete({ projectId: id, createdBy: userId });

    await this.projectsDao.deleteById(id);
  }
}
