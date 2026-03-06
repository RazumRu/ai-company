import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { GitProviderConnectionEntity } from '../entity/git-provider-connection.entity';

export type GitProviderConnectionSearchTerms = Partial<{
  id: string;
  userId: string;
  provider: string;
  accountLogin: string;
  isActive: boolean;
}>;

@Injectable()
export class GitProviderConnectionDao extends BaseDao<
  GitProviderConnectionEntity,
  GitProviderConnectionSearchTerms
> {
  public get alias() {
    return 'gpc';
  }

  protected get entity() {
    return GitProviderConnectionEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GitProviderConnectionEntity>,
    params?: GitProviderConnectionSearchTerms,
  ) {
    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.userId) {
      builder.andWhere({ userId: params.userId });
    }

    if (params?.provider) {
      builder.andWhere({ provider: params.provider });
    }

    if (params?.accountLogin) {
      builder.andWhere({ accountLogin: params.accountLogin });
    }

    if (params?.isActive !== undefined) {
      builder.andWhere({ isActive: params.isActive });
    }
  }
}
