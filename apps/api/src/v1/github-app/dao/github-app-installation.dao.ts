import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { GitHubAppInstallationEntity } from '../entity/github-app-installation.entity';

export type GitHubAppInstallationSearchTerms = Partial<{
  id: string;
  userId: string;
  installationId: number;
  accountLogin: string;
  isActive: boolean;
}>;

@Injectable()
export class GitHubAppInstallationDao extends BaseDao<
  GitHubAppInstallationEntity,
  GitHubAppInstallationSearchTerms
> {
  public get alias() {
    return 'gai';
  }

  protected get entity() {
    return GitHubAppInstallationEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GitHubAppInstallationEntity>,
    params?: GitHubAppInstallationSearchTerms,
  ) {
    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.userId) {
      builder.andWhere({ userId: params.userId });
    }

    if (params?.installationId !== undefined) {
      builder.andWhere({ installationId: params.installationId });
    }

    if (params?.accountLogin) {
      builder.andWhere({ accountLogin: params.accountLogin });
    }

    if (params?.isActive !== undefined) {
      builder.andWhere({ isActive: params.isActive });
    }
  }
}
