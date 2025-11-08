import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { GraphRevisionEntity } from '../entity/graph-revision.entity';
import { GraphRevisionStatus } from '../graphs.types';

export type SearchTerms = Partial<{
  id: string;
  graphId: string;
  createdBy: string;
  status: GraphRevisionStatus;
  statuses: GraphRevisionStatus[];
}>;

@Injectable()
export class GraphRevisionDao extends BaseDao<
  GraphRevisionEntity,
  SearchTerms,
  string
> {
  public get alias() {
    return 'gr';
  }

  protected get entity() {
    return GraphRevisionEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GraphRevisionEntity>,
    params?: SearchTerms,
  ) {
    if (params?.id) {
      builder.andWhere({
        id: params.id,
      });
    }

    if (params?.graphId) {
      builder.andWhere({
        graphId: params.graphId,
      });
    }

    if (params?.createdBy) {
      builder.andWhere({
        createdBy: params.createdBy,
      });
    }

    if (params?.statuses && params.statuses.length > 0) {
      builder.andWhere({
        status: In(params.statuses),
      });
    } else if (params?.status) {
      builder.andWhere({
        status: params.status,
      });
    }
  }
}
