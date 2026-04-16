import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { GraphEntity } from '../../graphs/entity/graph.entity';
import { ProjectEntity } from '../../projects/entity/project.entity';

export interface GraphCostLimitRow {
  projectId: string | null;
  settings: Record<string, unknown> | null;
}

export interface ProjectCostLimitRow {
  settings: Record<string, unknown> | null;
}

/**
 * Read-only DAO for resolving cost limits from graph/project settings JSONB columns.
 *
 * Deliberately does NOT extend `BaseDao<Entity>` and does NOT own `GraphEntity` / `ProjectEntity`
 * — those are owned by `GraphsModule.GraphDao` and `ProjectsModule.ProjectsDao` respectively.
 * This DAO performs a narrow read of the `settings.costLimitUsd` JSONB projection with no CRUD or
 * joins. Importing `GraphsModule` / `ProjectsModule` here would create a DI cycle with `AgentsModule`
 * (which already imports `GraphsModule`); querying the entities directly via `EntityManager` keeps
 * `CostLimitsModule` free of any inbound dependency on the owning feature modules.
 *
 * If this DAO ever needs write access or multi-column queries, promote the query to the owning DAO.
 */
@Injectable()
export class CostLimitsDao {
  constructor(private readonly em: EntityManager) {}

  async getGraphCostLimitRow(
    graphId: string,
  ): Promise<GraphCostLimitRow | null> {
    const row = await this.em.findOne(
      GraphEntity,
      { id: graphId },
      { fields: ['id', 'projectId', 'settings'] },
    );
    if (!row) {
      return null;
    }
    return {
      projectId: row.projectId ?? null,
      settings: row.settings ?? null,
    };
  }

  async getProjectCostLimitRow(
    projectId: string,
  ): Promise<ProjectCostLimitRow | null> {
    const row = await this.em.findOne(
      ProjectEntity,
      { id: projectId },
      { fields: ['id', 'settings'] },
    );
    if (!row) {
      return null;
    }
    return {
      settings: row.settings ?? null,
    };
  }
}
