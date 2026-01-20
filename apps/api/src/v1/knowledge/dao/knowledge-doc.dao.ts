import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { Brackets, DataSource, In } from 'typeorm';

import { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';

export type KnowledgeDocSearchTerms = Partial<{
  id: string;
  ids: string[];
  createdBy: string;
  tags: string[];
  search: string;
}>;

@Injectable()
export class KnowledgeDocDao extends BaseDao<
  KnowledgeDocEntity,
  KnowledgeDocSearchTerms,
  string
> {
  public get alias() {
    return 'kd';
  }

  protected get entity() {
    return KnowledgeDocEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<KnowledgeDocEntity>,
    params?: KnowledgeDocSearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({ id: In(params.ids) });
    }

    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.createdBy) {
      builder.andWhere({ createdBy: params.createdBy });
    }

    if (params?.tags && params.tags.length > 0) {
      builder.andWhere(`${this.alias}.tags ?| array[:...tags]`, {
        tags: params.tags,
      });
    }

    if (params?.search && params.search.trim().length > 0) {
      const query = `%${params.search.trim()}%`;
      builder.andWhere(
        new Brackets((qb) => {
          qb.where(`${this.alias}.title ILIKE :query`, { query })
            .orWhere(`${this.alias}.summary ILIKE :query`, { query })
            .orWhere(`${this.alias}.content ILIKE :query`, { query });
        }),
      );
    }
  }
}
