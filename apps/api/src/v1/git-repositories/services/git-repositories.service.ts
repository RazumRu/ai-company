import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BadRequestException,
  DefaultLogger,
  InternalException,
  NotFoundException,
} from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import type { InstallationUnlinkedEvent } from '../../git-auth/git-auth.types';
import { INSTALLATION_UNLINKED_EVENT } from '../../git-auth/git-auth.types';
import { GitHubAppService } from '../../git-auth/services/github-app.service';
import { GitHubAppProviderService } from '../../git-auth/services/github-app-provider.service';
import { ProjectsDao } from '../../projects/dao/projects.dao';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
import {
  CreateRepository,
  GetRepoIndexesQueryDto,
  GetRepositoriesQueryDto,
  GitRepositoryDto,
  RepoIndexDto,
  SyncRepositoriesResponse,
  TriggerReindex,
  TriggerReindexResponse,
  UpdateRepository,
} from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { RepoIndexEntity } from '../entity/repo-index.entity';
import {
  GitRepositoryProvider,
  RepoIndexStatus,
} from '../git-repositories.types';
import { RepoIndexQueueService } from './repo-index-queue.service';
import { RepoIndexerService } from './repo-indexer.service';

@Injectable()
export class GitRepositoriesService {
  private readonly syncInProgress = new Set<string>();

  constructor(
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly repoIndexDao: RepoIndexDao,
    private readonly repoIndexQueueService: RepoIndexQueueService,
    private readonly repoIndexerService: RepoIndexerService,
    private readonly qdrantService: QdrantService,
    private readonly logger: DefaultLogger,
    private readonly projectsDao: ProjectsDao,
    private readonly gitHubAppProviderService: GitHubAppProviderService,
    private readonly gitHubAppService: GitHubAppService,
  ) {}

  // Internal event only — emitted by GitHubAppProviderService after verifying ownership.
  // The userId filter in deleteRepositoriesByInstallationIds is defense-in-depth.
  @OnEvent(INSTALLATION_UNLINKED_EVENT)
  async onInstallationUnlinked(
    event: InstallationUnlinkedEvent,
  ): Promise<void> {
    await this.deleteRepositoriesByInstallationIds(
      event.userId,
      event.githubInstallationIds,
    );
  }

  async createRepository(
    ctx: AppContextStorage,
    data: CreateRepository,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();
    const projectId = ctx.checkProjectId();

    const project = await this.projectsDao.getOne({
      id: projectId,
      createdBy: userId,
    });
    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }

    const created = await this.gitRepositoriesDao.create({
      owner: data.owner,
      repo: data.repo,
      url: data.url,
      provider: data.provider,
      defaultBranch: data.defaultBranch ?? 'main',
      createdBy: userId,
      projectId,
      installationId: null,
      syncedAt: null,
    });

    return this.prepareRepositoryResponse(created);
  }

  async updateRepository(
    ctx: AppContextStorage,
    id: string,
    data: UpdateRepository,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    const existing = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!existing) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    const updatePayload: Record<string, unknown> = {};
    if (data.url) {
      updatePayload.url = data.url;
    }
    if (data.defaultBranch) {
      updatePayload.defaultBranch = data.defaultBranch;
    }

    // If nothing changed, return existing entity without a DB write
    if (Object.keys(updatePayload).length === 0) {
      return this.prepareRepositoryResponse(existing);
    }

    const updated = await this.gitRepositoriesDao.updateById(id, updatePayload);

    return this.prepareRepositoryResponse(updated!);
  }

  async getRepositories(
    ctx: AppContextStorage,
    query: GetRepositoriesQueryDto,
  ): Promise<GitRepositoryDto[]> {
    const userId = ctx.checkSub();

    const searchParams: Parameters<typeof this.gitRepositoriesDao.getAll>[0] = {
      createdBy: userId,
      owner: query.owner,
      repo: query.repo,
      provider: query.provider,
      limit: query.limit,
      offset: query.offset,
      order: { createdAt: 'DESC' },
    };

    if (query.installationId !== undefined) {
      searchParams.installationId = query.installationId;
    }

    const repositories = await this.gitRepositoriesDao.getAll(searchParams);

    return repositories.map((repo) => this.prepareRepositoryResponse(repo));
  }

  async getRepositoryById(
    ctx: AppContextStorage,
    id: string,
  ): Promise<GitRepositoryDto> {
    const userId = ctx.checkSub();

    const repository = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    return this.prepareRepositoryResponse(repository);
  }

  async deleteRepository(ctx: AppContextStorage, id: string): Promise<void> {
    const userId = ctx.checkSub();

    // Verify repository exists and belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    await this.cleanupRepositoryResourcesById(id);

    // Delete the repository (CASCADE will delete repo_indexes rows)
    await this.gitRepositoriesDao.deleteById(id);
  }

  async getRepoIndexes(
    ctx: AppContextStorage,
    query: GetRepoIndexesQueryDto,
  ): Promise<RepoIndexDto[]> {
    const userId = ctx.checkSub();

    // If repositoryId is provided, verify it belongs to the user
    if (query.repositoryId) {
      const repository = await this.gitRepositoriesDao.getOne({
        id: query.repositoryId,
        createdBy: userId,
      });

      if (!repository) {
        throw new NotFoundException('REPOSITORY_NOT_FOUND');
      }
    }

    // Fetch only the IDs of user-owned repos for a DB-level IN filter,
    // rather than loading full entities and filtering in memory.
    const userRepos = await this.gitRepositoriesDao.getAll({
      createdBy: userId,
      projection: ['id'],
      rawData: true,
    });

    const userRepoIds = userRepos.map((repo) => repo.id);
    if (userRepoIds.length === 0) {
      return [];
    }

    // Build search params — filter by repositoryIds at the DB level
    const searchParams: Parameters<typeof this.repoIndexDao.getAll>[0] = {
      limit: query.limit,
      offset: query.offset,
      order: { createdAt: 'DESC' },
    };

    if (query.repositoryId) {
      searchParams.repositoryId = query.repositoryId;
    } else {
      searchParams.repositoryIds = userRepoIds;
    }

    if (query.branches && query.branches.length > 0) {
      searchParams.branch = query.branches;
    } else if (query.branch) {
      searchParams.branch = query.branch;
    }

    if (query.status) {
      searchParams.status = query.status as RepoIndexStatus;
    }

    const indexes = await this.repoIndexDao.getAll(searchParams);

    return indexes.map((index) => this.prepareRepoIndexResponse(index));
  }

  async getRepoIndexByRepositoryId(
    ctx: AppContextStorage,
    repositoryId: string,
    branch?: string,
  ): Promise<RepoIndexDto | null> {
    const userId = ctx.checkSub();

    // Verify repository belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id: repositoryId,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    let index: RepoIndexEntity | null;
    if (branch) {
      index = await this.repoIndexDao.getOne({
        repositoryId,
        branch,
      });
    } else {
      // No branch specified — return the most recently updated index
      const indexes = await this.repoIndexDao.getAll({
        repositoryId,
        limit: 1,
        order: { updatedAt: 'DESC' },
      });
      index = indexes[0] ?? null;
    }

    if (!index) {
      return null;
    }

    return this.prepareRepoIndexResponse(index);
  }

  async triggerReindex(
    ctx: AppContextStorage,
    data: TriggerReindex,
  ): Promise<TriggerReindexResponse> {
    const userId = ctx.checkSub();

    // Verify repository belongs to user
    const repository = await this.gitRepositoriesDao.getOne({
      id: data.repositoryId,
      createdBy: userId,
    });

    if (!repository) {
      throw new NotFoundException('REPOSITORY_NOT_FOUND');
    }

    const branch = data.branch ?? repository.defaultBranch;
    // Normalize so the Qdrant repo_id is always consistent
    const normalizedRepoUrl = this.repoIndexerService.deriveRepoId(
      repository.url,
    );

    // Check if indexing is already in progress. Include soft-deleted rows
    // so we can restore them instead of hitting a unique constraint violation.
    const existingIndex = await this.repoIndexDao.getOne({
      repositoryId: data.repositoryId,
      branch,
      withDeleted: true,
    } as Parameters<typeof this.repoIndexDao.getOne>[0]);

    const isSoftDeleted = existingIndex?.deletedAt != null;

    if (
      existingIndex &&
      !isSoftDeleted &&
      (existingIndex.status === RepoIndexStatus.InProgress ||
        existingIndex.status === RepoIndexStatus.Pending)
    ) {
      throw new BadRequestException('INDEXING_ALREADY_IN_PROGRESS');
    }

    // Calculate metadata fields upfront so they're available immediately
    const { embeddingModel, vectorSize, chunkingSignatureHash, collection } =
      await this.repoIndexerService.calculateIndexMetadata(
        data.repositoryId,
        branch,
      );

    // Reset the index to pending status and enqueue
    let repoIndex: RepoIndexEntity;

    if (existingIndex) {
      // Restore soft-deleted row before updating
      if (isSoftDeleted) {
        await this.repoIndexDao.restoreById(existingIndex.id);
      }
      // Reset existing index with calculated metadata
      // Keep previous estimatedTokens as a rough estimate until new calculation completes
      await this.repoIndexDao.updateById(existingIndex.id, {
        repoUrl: normalizedRepoUrl,
        status: RepoIndexStatus.Pending,
        qdrantCollection: collection,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        errorMessage: null,
        indexedTokens: 0,
        lastIndexedCommit: null,
        // Preserve estimatedTokens from previous index as initial estimate
        estimatedTokens: isSoftDeleted ? 0 : existingIndex.estimatedTokens,
      });
      repoIndex = {
        ...existingIndex,
        deletedAt: null,
        repoUrl: normalizedRepoUrl,
        status: RepoIndexStatus.Pending,
        qdrantCollection: collection,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        errorMessage: null,
        indexedTokens: 0,
        lastIndexedCommit: null,
        estimatedTokens: isSoftDeleted ? 0 : existingIndex.estimatedTokens,
      };
    } else {
      // Create new index entry with calculated metadata
      repoIndex = await this.repoIndexDao.create({
        repositoryId: data.repositoryId,
        repoUrl: normalizedRepoUrl,
        branch,
        status: RepoIndexStatus.Pending,
        qdrantCollection: collection,
        lastIndexedCommit: null,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        estimatedTokens: 0,
        indexedTokens: 0,
        errorMessage: null,
      });
    }

    // Enqueue the indexing job
    await this.repoIndexQueueService.addIndexJob({
      repoIndexId: repoIndex.id,
      repoUrl: normalizedRepoUrl,
      branch,
    });

    return {
      repoIndex: this.prepareRepoIndexResponse(repoIndex),
      message: 'Repository indexing has been queued',
    };
  }

  async syncRepositories(
    ctx: AppContextStorage,
  ): Promise<SyncRepositoriesResponse> {
    const userId = ctx.checkSub();

    if (!this.gitHubAppProviderService.isConfigured()) {
      throw new BadRequestException('GITHUB_APP_NOT_CONFIGURED');
    }

    if (this.syncInProgress.has(userId)) {
      throw new BadRequestException('SYNC_ALREADY_IN_PROGRESS');
    }

    this.syncInProgress.add(userId);
    try {
      return await this.performSync(userId);
    } finally {
      this.syncInProgress.delete(userId);
    }
  }

  private async performSync(userId: string): Promise<SyncRepositoriesResponse> {
    const installations =
      await this.gitHubAppProviderService.getActiveInstallations(userId);

    this.logger.log(
      `[git-sync] user=${userId} active_installations=${installations.length} installation_ids=${
        installations
          .map(
            (installation) => installation.metadata['installationId'] as number,
          )
          .join(',') || '(none)'
      }`,
    );

    if (installations.length === 0) {
      this.logger.log(
        `[git-sync] user=${userId} no active installations, returning empty sync result`,
      );
      return { synced: 0, removed: 0, total: 0 };
    }

    const syncedAt = new Date();
    const allGithubRepos: {
      owner: string;
      repo: string;
      url: string;
      defaultBranch: string;
      installationId: number;
    }[] = [];

    for (const installation of installations) {
      const ghInstallationId = installation.metadata[
        'installationId'
      ] as number;
      this.logger.log(
        `[git-sync] user=${userId} installation=${ghInstallationId} account=${installation.accountLogin} starting sync`,
      );
      let token: string;
      try {
        token =
          await this.gitHubAppService.getInstallationToken(ghInstallationId);
        this.logger.log(
          `[git-sync] user=${userId} installation=${ghInstallationId} token fetched successfully`,
        );
      } catch (err) {
        this.logger.warn(
          `Installation ${ghInstallationId} token fetch failed, auto-deactivating: ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.gitHubAppProviderService.deactivateByInstallationId(
          userId,
          ghInstallationId,
        );
        continue;
      }

      let page = 1;
      let totalCount: number;
      let installationAccessible = true;

      do {
        const response = await fetch(
          `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );

        this.logger.log(
          `[git-sync] user=${userId} installation=${ghInstallationId} page=${page} github_status=${response.status}`,
        );

        const rateLimitRemaining = response.headers.get(
          'x-ratelimit-remaining',
        );
        if (
          response.status === 429 ||
          (response.status === 403 && rateLimitRemaining === '0')
        ) {
          throw new InternalException('GITHUB_RATE_LIMITED');
        }

        if (!response.ok) {
          this.logger.warn(
            `Installation ${ghInstallationId} repository listing failed with status ${response.status}, auto-deactivating`,
          );
          await this.gitHubAppProviderService.deactivateByInstallationId(
            userId,
            ghInstallationId,
          );
          installationAccessible = false;
          break;
        }

        const data = (await response.json()) as {
          total_count: number;
          repositories: {
            owner: { login: string };
            name: string;
            html_url: string;
            default_branch: string | null;
          }[];
        };

        totalCount = data.total_count;
        this.logger.log(
          `[git-sync] user=${userId} installation=${ghInstallationId} page=${page} repositories_received=${data.repositories.length} total_count=${data.total_count}`,
        );

        for (const ghRepo of data.repositories) {
          allGithubRepos.push({
            owner: ghRepo.owner.login,
            repo: ghRepo.name,
            url: ghRepo.html_url,
            defaultBranch: ghRepo.default_branch ?? 'main',
            installationId: ghInstallationId,
          });
        }

        if (data.repositories.length < 100) {
          break;
        }
        page++;
      } while (allGithubRepos.length < totalCount);

      if (!installationAccessible) {
        continue;
      }

      this.logger.log(
        `[git-sync] user=${userId} installation=${ghInstallationId} completed sync pass`,
      );
    }

    if (allGithubRepos.length > 0) {
      const upsertData = allGithubRepos.map((r) => ({
        owner: r.owner,
        repo: r.repo,
        url: r.url,
        provider: GitRepositoryProvider.GITHUB,
        defaultBranch: r.defaultBranch,
        createdBy: userId,
        projectId: null,
        installationId: r.installationId,
        syncedAt,
      }));

      await this.gitRepositoriesDao.upsertGithubSyncRepos(upsertData);

      await this.gitRepositoriesDao.restoreSoftDeleted(
        userId,
        allGithubRepos.map((r) => ({ owner: r.owner, repo: r.repo })),
      );
    }

    const existingRepos = await this.gitRepositoriesDao.getAll({
      createdBy: userId,
      hasInstallationId: true,
    });

    const syncedKeys = new Set(
      allGithubRepos.map((r) => `${r.owner}/${r.repo}`),
    );
    const toRemove = existingRepos.filter(
      (r) => !syncedKeys.has(`${r.owner}/${r.repo}`),
    );

    for (const repo of toRemove) {
      await this.cleanupRepositoryResourcesById(repo.id);
      await this.gitRepositoriesDao.deleteById(repo.id);
    }

    const total = await this.gitRepositoriesDao.count({ createdBy: userId });

    this.logger.log(
      `[git-sync] user=${userId} sync complete synced=${allGithubRepos.length} removed=${toRemove.length} total=${total}`,
    );

    return {
      synced: allGithubRepos.length,
      removed: toRemove.length,
      total,
    };
  }

  /**
   * Delete all repositories associated with the given GitHub App installation IDs.
   * Cleans up Qdrant indexes and BullMQ jobs for each repository before deletion.
   * Used when installations are deactivated (unlink/disconnect).
   */
  async deleteRepositoriesByInstallationIds(
    userId: string,
    installationIds: number[],
  ): Promise<number> {
    if (installationIds.length === 0) {
      return 0;
    }

    const repos = await this.gitRepositoriesDao.getAll({
      createdBy: userId,
      installationIds,
    });

    for (const repo of repos) {
      await this.cleanupRepositoryResourcesById(repo.id);
      await this.gitRepositoriesDao.deleteById(repo.id);
    }

    return repos.length;
  }

  /**
   * Remove all BullMQ jobs and Qdrant collections associated with a repository's indexes.
   * Called before deleting a repository to ensure external resources are cleaned up.
   */
  private async cleanupRepositoryResourcesById(
    repositoryId: string,
  ): Promise<void> {
    const repoIndexes = await this.repoIndexDao.getAll({ repositoryId });

    const collections = new Set<string>();
    for (const index of repoIndexes) {
      if (index.qdrantCollection) {
        collections.add(index.qdrantCollection);
      }
      await this.repoIndexQueueService.removeJob(index.id);
    }

    for (const collection of collections) {
      try {
        await this.qdrantService.deleteCollection(collection);
      } catch (error) {
        this.logger.warn(`Failed to delete Qdrant collection ${collection}`, {
          collection,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Soft-delete repo_index rows so they don't appear as "indexed" if the
    // repository is restored during a future sync. The unique constraint
    // still covers soft-deleted rows, so getOrInitIndexForRepo will restore
    // and reset them when re-indexing is triggered.
    await this.repoIndexDao.delete({ repositoryId });
  }

  private prepareRepositoryResponse(
    entity: GitRepositoryEntity,
  ): GitRepositoryDto {
    return {
      id: entity.id,
      owner: entity.owner,
      repo: entity.repo,
      url: entity.url,
      provider: entity.provider,
      defaultBranch: entity.defaultBranch,
      createdBy: entity.createdBy,
      projectId: entity.projectId,
      installationId: entity.installationId,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  private prepareRepoIndexResponse(entity: RepoIndexEntity): RepoIndexDto {
    return {
      id: entity.id,
      repositoryId: entity.repositoryId,
      repoUrl: entity.repoUrl,
      branch: entity.branch,
      status: entity.status,
      qdrantCollection: entity.qdrantCollection,
      lastIndexedCommit: entity.lastIndexedCommit,
      embeddingModel: entity.embeddingModel,
      vectorSize: entity.vectorSize,
      chunkingSignatureHash: entity.chunkingSignatureHash,
      estimatedTokens: entity.estimatedTokens,
      indexedTokens: entity.indexedTokens,
      errorMessage: entity.errorMessage,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }
}
