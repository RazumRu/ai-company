import { EntityManager, FilterQuery, FindOptions } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GraphEntity } from '../entity/graph.entity';
import { type GraphAgentInfo } from '../graphs.types';

@Injectable()
export class GraphDao extends BaseDao<GraphEntity> {
  constructor(em: EntityManager) {
    super(em, GraphEntity);
  }

  async getAgentsByGraphIds(
    graphIds: string[],
  ): Promise<Map<string, GraphAgentInfo[]>> {
    const result = new Map<string, GraphAgentInfo[]>();
    if (graphIds.length === 0) {
      return result;
    }
    const rows = await this.getAll(
      { id: { $in: graphIds } },
      { fields: ['id', 'agents'] },
    );
    for (const row of rows) {
      result.set(row.id, row.agents ?? []);
    }
    return result;
  }

  async getPreview(
    where: FilterQuery<GraphEntity>,
    options?: FindOptions<GraphEntity, never, keyof GraphEntity & string>,
  ) {
    return await this.getAll(where, {
      fields: [
        'id',
        'name',
        'description',
        'error',
        'version',
        'targetVersion',
        'status',
        'temporary',
        'createdBy',
        'projectId',
        'createdAt',
        'updatedAt',
        'settings',
      ],
      ...options,
    });
  }

  async getSchemaAndMetadata(
    graphIds: string[],
  ): Promise<Map<string, Pick<GraphEntity, 'schema' | 'metadata' | 'agents'>>> {
    const result = new Map<
      string,
      Pick<GraphEntity, 'schema' | 'metadata' | 'agents'>
    >();
    if (graphIds.length === 0) {
      return result;
    }
    const rows = await this.getAll(
      { id: { $in: graphIds } },
      { fields: ['id', 'schema', 'metadata', 'agents'] },
    );
    for (const row of rows) {
      result.set(row.id, {
        schema: row.schema,
        metadata: row.metadata,
        agents: row.agents,
      });
    }
    return result;
  }
}
