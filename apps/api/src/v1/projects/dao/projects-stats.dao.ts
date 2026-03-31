import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

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

    const placeholders = projectIds.map(() => '?').join(', ');

    const rows = await this.em.getConnection().execute<ProjectStatRow[]>(
      `SELECT p.id AS "projectId",
              count(DISTINCT g.id)::text AS "graphCount",
              count(DISTINCT th.id)::text AS "threadCount"
         FROM projects p
         LEFT JOIN graphs g
           ON g.project_id = p.id AND g.deleted_at IS NULL AND g.temporary = false
         LEFT JOIN threads th
           ON th.graph_id = g.id AND th.deleted_at IS NULL
        WHERE p.id IN (${placeholders})
        GROUP BY p.id`,
      projectIds,
    );

    return rows;
  }
}
