import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException } from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { ProjectsDao } from '../dao/projects.dao';
import { ProjectsStatsDao } from '../dao/projects-stats.dao';
import {
  CreateProjectDto,
  ProjectDto,
  UpdateProjectDto,
} from '../dto/projects.dto';
import { ProjectEntity } from '../entity/project.entity';
import { PROJECT_DELETED_EVENT, ProjectDeletedEvent } from '../projects.events';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsDao: ProjectsDao,
    private readonly projectsStatsDao: ProjectsStatsDao,
    private readonly em: EntityManager,
    private readonly eventEmitter: EventEmitter2,
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

    return await this.em.transactional(async (em: EntityManager) => {
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
    const rows = await this.projectsDao.getAll(
      { createdBy: userId },
      { orderBy: { updatedAt: 'DESC' } },
    );

    if (rows.length === 0) {
      return [];
    }

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

    return await this.em.transactional(async (em: EntityManager) => {
      const existing = await this.projectsDao.getOne({ id, createdBy: userId });
      if (!existing) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }

      await this.projectsDao.updateById(id, dto, em);
      const updated = await this.projectsDao.getOne({ id, createdBy: userId });
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

    await this.eventEmitter.emitAsync(PROJECT_DELETED_EVENT, {
      projectId: id,
      userId,
    } satisfies ProjectDeletedEvent);

    await this.projectsDao.deleteById(id);
  }
}
