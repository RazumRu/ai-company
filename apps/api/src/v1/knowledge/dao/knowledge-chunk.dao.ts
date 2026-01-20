import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In, SelectQueryBuilder } from 'typeorm';

import { KnowledgeChunkEntity } from '../entity/knowledge-chunk.entity';

export type ExtendedKnowledgeChunkEntity = KnowledgeChunkEntity & {
  score?: number;
};

export type KnowledgeChunkSearchTerms = Partial<{
  id: string;
  ids: string[];
  docId: string;
  docIds: string[];
  embedding: string;
}>;

@Injectable()
export class KnowledgeChunkDao extends BaseDao<
  ExtendedKnowledgeChunkEntity,
  KnowledgeChunkSearchTerms,
  string
> {
  public get alias() {
    return 'kc';
  }

  protected get entity() {
    return KnowledgeChunkEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<ExtendedKnowledgeChunkEntity>,
    params?: KnowledgeChunkSearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({ id: In(params.ids) });
    }

    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.docIds && params.docIds.length > 0) {
      builder.andWhere({ docId: In(params.docIds) });
    } else if (params?.docId) {
      builder.andWhere({ docId: params.docId });
    }
  }

  protected applyMutationParams(
    builder: SelectQueryBuilder<KnowledgeChunkEntity>,
    params?: KnowledgeChunkSearchTerms,
  ): void {
    if (params?.embedding) {
      builder.addSelect(
        `1 - (${this.alias}.embedding <=> :embedding)`,
        'score',
      );
      builder.setParameter('embedding', params.embedding);
    }
  }
}
