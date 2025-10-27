import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { MessageEntity } from '../entity/message.entity';

export type SearchTerms = Partial<{
  id: string;
  ids: string[];
  createdBy: string;
  threadId: string;
  externalThreadId: string;
  nodeId: string;
}>;

@Injectable()
export class MessagesDao extends BaseDao<MessageEntity, SearchTerms, string> {
  public get alias() {
    return 'm';
  }

  protected get entity() {
    return MessageEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<MessageEntity>,
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

    if (params?.createdBy) {
      builder.andWhere({
        createdBy: params.createdBy,
      });
    }

    if (params?.threadId) {
      builder.andWhere({
        threadId: params.threadId,
      });
    }

    if (params?.externalThreadId) {
      builder.andWhere({
        externalThreadId: params.externalThreadId,
      });
    }

    if (params?.nodeId) {
      builder.andWhere({
        nodeId: params.nodeId,
      });
    }
  }
}
