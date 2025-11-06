import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { isBoolean } from 'lodash';
import { DataSource, In } from 'typeorm';

import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';

export type SearchTerms = Partial<{
  id: string;
  createdBy: string;
  ids: string[];
  status: GraphStatus;
  statuses: GraphStatus[];
  temporary: boolean;
}>;

@Injectable()
export class GraphDao extends BaseDao<GraphEntity, SearchTerms, string> {
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
  }
}
