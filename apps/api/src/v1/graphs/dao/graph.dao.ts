import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { isBoolean } from 'lodash';
import { DataSource, In } from 'typeorm';

import { GraphEntity } from '../entity/graph.entity';
import { type GraphAgentInfo, GraphStatus } from '../graphs.types';

export type SearchTerms = Partial<{
  id: string;
  createdBy: string;
  ids: string[];
  status: GraphStatus;
  statuses: GraphStatus[];
  temporary: boolean;
  projectId: string;
}>;

@Injectable()
export class GraphDao extends BaseDao<GraphEntity, SearchTerms> {
  public get alias() {
    return 'g';
  }

  protected get entity() {
    return GraphEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GraphEntity>,
    params?: SearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({
        id: In(params?.ids),
      });
    }

    if (params?.id) {
      builder.andWhere({
        id: params.id,
      });
    }

    if (isBoolean(params?.temporary)) {
      builder.andWhere({
        temporary: params.temporary,
      });
    }

    if (params?.statuses && params.statuses.length > 0) {
      builder.andWhere(`${this.alias}.status IN (:...statuses)`, {
        statuses: params.statuses,
      });
    } else if (params?.status) {
      builder.andWhere({
        status: params.status,
      });
    }

    if (params?.createdBy) {
      builder.andWhere({
        createdBy: params.createdBy,
      });
    }

    if (params?.projectId) {
      builder.andWhere({
        projectId: params.projectId,
      });
    }
  }

  async getAgentsByGraphIds(
    graphIds: string[],
  ): Promise<Map<string, GraphAgentInfo[]>> {
    const result = new Map<string, GraphAgentInfo[]>();
    if (graphIds.length === 0) return result;
    const rows = await this.getQueryBuilder()
      .select([`${this.alias}.id`, `${this.alias}.agents`])
      .where(`${this.alias}.id IN (:...graphIds)`, { graphIds })
      .getMany();
    for (const row of rows) {
      result.set(row.id, row.agents ?? []);
    }
    return result;
  }
}
