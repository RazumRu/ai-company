import { raw, sql } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { ProjectEntity } from '../entity/project.entity';

export type ProjectStatRow = {
  projectId: string;
  graphCount: string;
  threadCount: string;
};

@Injectable()
export class ProjectsStatsDao {
  constructor(private readonly em: EntityManager) {}

  async countStatsByProjectIds(
    projectIds: string[],
  ): Promise<ProjectStatRow[]> {
    if (projectIds.length === 0) {
      return [];
    }

    const qb = this.em.createQueryBuilder(ProjectEntity, 'p');

    return await qb
      .select([
        raw('p.id as "projectId"'),
        raw('count(distinct g.id)::text as "graphCount"'),
        raw('count(distinct th.id)::text as "threadCount"'),
      ])
      .leftJoin(raw('graphs'), 'g', {
        project_id: sql.ref('p.id'),
        deleted_at: null,
        temporary: false,
      })
      .leftJoin(raw('threads'), 'th', {
        graph_id: sql.ref('g.id'),
        deleted_at: null,
      })
      .where({ id: { $in: projectIds } })
      .groupBy(raw('p.id'))
      .execute<ProjectStatRow[]>();
  }
}
