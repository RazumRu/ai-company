import { Injectable } from '@nestjs/common';

import { ProjectsDao } from '../../projects/dao/projects.dao';
import { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import { GraphDao } from '../dao/graph.dao';

@Injectable()
export class CostLimitResolverService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly projectsDao: ProjectsDao,
    private readonly userPreferencesService: UserPreferencesService,
  ) {}

  async resolveForThread(
    userId: string,
    graphId: string,
  ): Promise<number | null> {
    const graph = await this.graphDao.getById(graphId);
    const graphLimit = this.toLimit(graph?.settings?.['costLimitUsd']);

    let projectLimit: number | null = null;
    if (graph?.projectId) {
      const project = await this.projectsDao.getById(graph.projectId);
      projectLimit = this.toLimit(project?.settings?.['costLimitUsd']);
    }

    const userLimit = this.toLimit(
      await this.userPreferencesService.getCostLimitForUser(userId),
    );

    const candidates = [graphLimit, projectLimit, userLimit].filter(
      (v): v is number => v !== null,
    );
    if (candidates.length === 0) {
      return null;
    }
    return Math.min(...candidates);
  }

  private toLimit(value: unknown): number | null {
    if (typeof value !== 'number') {
      return null;
    }
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
    if (value <= 0) {
      return null;
    }
    return value;
  }
}
