import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { GraphEntity } from '../../graphs/entity/graph.entity';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { ProjectEntity } from '../entity/project.entity';

export type ProjectStatRow = {
  projectId: string;
  graphCount: string;
  threadCount: string;
};

@Injectable()
export class ProjectsStatsDao {
  constructor(private readonly dataSource: DataSource) {}

  async countStatsByProjectIds(
    projectIds: string[],
  ): Promise<ProjectStatRow[]> {
    if (projectIds.length === 0) {
      return [];
    }

    return this.dataSource
      .createQueryBuilder()
      .select('p.id', 'projectId')
      .addSelect('COUNT(DISTINCT g.id)::text', 'graphCount')
      .addSelect('COUNT(DISTINCT th.id)::text', 'threadCount')
      .from(ProjectEntity, 'p')
      .leftJoin(
        GraphEntity,
        'g',
        'g."projectId" = p.id AND g."deletedAt" IS NULL AND g.temporary = :temporary',
        { temporary: false },
      )
      .leftJoin(
        ThreadEntity,
        'th',
        'th."graphId" = g.id AND th."deletedAt" IS NULL',
      )
      .where('p.id IN (:...projectIds)', { projectIds })
      .andWhere('p."deletedAt" IS NULL')
      .groupBy('p.id')
      .getRawMany<ProjectStatRow>();
  }
}
