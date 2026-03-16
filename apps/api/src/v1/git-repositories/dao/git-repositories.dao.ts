import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

export type GithubSyncRepo = {
  owner: string;
  repo: string;
  url: string;
  provider: string;
  defaultBranch: string;
  createdBy: string;
  projectId: string | null;
  installationId: number;
  syncedAt: Date;
};

import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { GitRepositoryProvider } from '../git-repositories.types';

export type SearchTerms = Partial<{
  id: string;
  ids: string[];
  owner: string;
  repo: string;
  provider: GitRepositoryProvider;
  createdBy: string;
  projectId: string;
  hasInstallationId: boolean;
  installationIds: number[];
  installationId: number;
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

    if (params?.projectId) {
      builder.andWhere({
        projectId: params.projectId,
      });
    }

    if (params?.hasInstallationId !== undefined) {
      if (params.hasInstallationId) {
        builder.andWhere(`${this.alias}.installationId IS NOT NULL`);
      } else {
        builder.andWhere(`${this.alias}.installationId IS NULL`);
      }
    }

    if (params?.installationIds && params.installationIds.length > 0) {
      builder.andWhere({
        installationId: In(params.installationIds),
      });
    }

    if (params?.installationId !== undefined) {
      builder.andWhere({ installationId: params.installationId });
    }
  }

  /**
   * Upsert repos from a GitHub App sync. On conflict, updates url, defaultBranch,
   * installationId, and syncedAt without touching other user-managed fields.
   */
  async upsertGithubSyncRepos(repos: GithubSyncRepo[]): Promise<void> {
    if (!repos.length) {
      return;
    }

    const params: unknown[] = [];
    const valuePlaceholders = repos.map((r) => {
      const base = params.length;
      params.push(
        r.owner,
        r.repo,
        r.url,
        r.provider,
        r.defaultBranch,
        r.createdBy,
        r.projectId,
        r.installationId,
        r.syncedAt,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
    });

    await this.repository.query(
      `INSERT INTO git_repositories
         (owner, repo, url, provider, "defaultBranch", "createdBy", "projectId", "installationId", "syncedAt")
       VALUES ${valuePlaceholders.join(',')}
       ON CONFLICT (owner, repo, "createdBy", provider) DO UPDATE SET
         url = EXCLUDED.url,
         "defaultBranch" = EXCLUDED."defaultBranch",
         "installationId" = EXCLUDED."installationId",
         "syncedAt" = EXCLUDED."syncedAt",
         "updatedAt" = NOW()`,
      params,
    );
  }

  async restoreSoftDeleted(
    userId: string,
    ownerRepoPairs: { owner: string; repo: string }[],
  ): Promise<void> {
    if (!ownerRepoPairs.length) {
      return;
    }
    const params: unknown[] = [userId];
    const tuples = ownerRepoPairs.map((pair) => {
      params.push(pair.owner, pair.repo);
      const base = params.length;
      return `($${base - 1}, $${base})`;
    });
    await this.repository.query(
      `UPDATE git_repositories
       SET "deletedAt" = NULL
       WHERE "createdBy" = $1
         AND ("owner", "repo") IN (${tuples.join(',')})
         AND "deletedAt" IS NOT NULL`,
      params,
    );
  }
}
