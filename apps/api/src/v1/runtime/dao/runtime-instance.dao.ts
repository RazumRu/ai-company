import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';

export type RuntimeInstanceSearchTerms = Partial<{
  id: string;
  ids: string[];
  graphId: string;
  nodeId: string;
  threadId: string;
  type: RuntimeType;
  status: RuntimeInstanceStatus;
  statuses: RuntimeInstanceStatus[];
  lastUsedBefore: Date;
  temporary: boolean;
}>;

@Injectable()
export class RuntimeInstanceDao extends BaseDao<
  RuntimeInstanceEntity,
  RuntimeInstanceSearchTerms,
  string
> {
  public get alias() {
    return 'ri';
  }

  protected get entity() {
    return RuntimeInstanceEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<RuntimeInstanceEntity>,
    params?: RuntimeInstanceSearchTerms,
  ) {
    if (!params) return;

    if (params.ids && params.ids.length > 0) {
      builder.andWhere({ id: In(params.ids) });
    }

    if (params.id) {
      builder.andWhere({ id: params.id });
    }

    if (params.graphId) {
      builder.andWhere({ graphId: params.graphId });
    }

    if (params.nodeId) {
      builder.andWhere({ nodeId: params.nodeId });
    }

    if (params.threadId) {
      builder.andWhere({ threadId: params.threadId });
    }

    if (params.type) {
      builder.andWhere({ type: params.type });
    }

    if (params.status) {
      builder.andWhere({ status: params.status });
    }

    if (params.statuses && params.statuses.length > 0) {
      builder.andWhere({ status: In(params.statuses) });
    }

    if (params.lastUsedBefore) {
      builder.andWhere('ri.lastUsedAt < :lastUsedBefore', {
        lastUsedBefore: params.lastUsedBefore,
      });
    }

    if (params.temporary !== undefined) {
      builder.andWhere({ temporary: params.temporary });
    }
  }
}
