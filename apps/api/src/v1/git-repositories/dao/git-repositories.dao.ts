import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { GitRepositoryProvider } from '../git-repositories.types';

export type SearchTerms = Partial<{
  id: string;
  ids: string[];
  owner: string;
  repo: string;
  provider: GitRepositoryProvider;
  createdBy: string;
}>;

@Injectable()
export class GitRepositoriesDao extends BaseDao<
  GitRepositoryEntity,
  SearchTerms
> {
  public get alias() {
    return 'gr';
  }

  protected get entity() {
    return GitRepositoryEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<GitRepositoryEntity>,
    params?: SearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({
        id: In(params.ids),
      });
    }

    if (params?.id) {
      builder.andWhere({
        id: params.id,
      });
    }

    if (params?.owner) {
      builder.andWhere({
        owner: params.owner,
      });
    }

    if (params?.repo) {
      builder.andWhere({
        repo: params.repo,
      });
    }

    if (params?.provider) {
      builder.andWhere({
        provider: params.provider,
      });
    }

    if (params?.createdBy) {
      builder.andWhere({
        createdBy: params.createdBy,
      });
    }
  }
}
