import { Injectable, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { RuntimeInstanceDao } from '../../runtime/dao/runtime-instance.dao';
import { RuntimeType } from '../../runtime/runtime.types';
import { RuntimeProvider } from '../../runtime/services/runtime-provider';
import { shQuote } from '../../utils/shell.utils';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { RepoIndexEntity } from '../entity/repo-index.entity';
import { RepoIndexStatus } from '../git-repositories.types';
import { GitRepositoriesService } from './git-repositories.service';
import {
  GetOrInitIndexParams,
  GetOrInitIndexResult,
  SearchCodebaseParams,
  SearchCodebaseResult,
} from './repo-index.types';
import {
  RepoIndexJobData,
  RepoIndexQueueService,
} from './repo-index-queue.service';
import { RepoExecFn, RepoIndexerService } from './repo-indexer.service';

const REPO_CLONE_DIR = '/workspace/repo';

@Injectable()
export class RepoIndexService implements OnModuleInit {
  constructor(
    private readonly repoIndexDao: RepoIndexDao,
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly gitRepositoriesService: GitRepositoriesService,
    private readonly repoIndexerService: RepoIndexerService,
    private readonly repoIndexQueueService: RepoIndexQueueService,
    private readonly llmModelsService: LlmModelsService,
    private readonly openaiService: OpenaiService,
    private readonly qdrantService: QdrantService,
    private readonly runtimeProvider: RuntimeProvider,
    private readonly runtimeInstanceDao: RuntimeInstanceDao,
    private readonly logger: DefaultLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.repoIndexQueueService.setCallbacks({
      onProcess: this.processIndexJob.bind(this),
      onStalled: this.handleStalledJob.bind(this),
      onFailed: this.handleFailedJob.bind(this),
    });
    await this.recoverStuckJobs();
  }

  /**
   * Called when a job is detected as stalled (server died mid-processing).
   * Resets the database status so the job can be reprocessed.
   */
  private async handleStalledJob(repoIndexId: string): Promise<void> {
    this.logger.warn('Repo index job stalled, resetting status', {
      repoIndexId,
    });

    await this.repoIndexDao.updateById(repoIndexId, {
      status: RepoIndexStatus.Pending,
    });
  }

  /**
   * Called when a job fails after all retries are exhausted.
   */
  private async handleFailedJob(
    repoIndexId: string,
    error: Error,
  ): Promise<void> {
    this.logger.error(error, 'Repo index job failed permanently', {
      repoIndexId,
    });

    await this.repoIndexDao.updateById(repoIndexId, {
      status: RepoIndexStatus.Failed,
      errorMessage: error.message,
    });
  }

  /**
   * On server restart, re-enqueue any incomplete indexing jobs.
   * The database is the source of truth - if status is Pending/InProgress,
   * the job needs to be in the queue.
   */
  private async recoverStuckJobs(): Promise<void> {
    try {
      const incompleteJobs = await this.repoIndexDao.getAll({
        status: [RepoIndexStatus.InProgress, RepoIndexStatus.Pending],
      });

      if (incompleteJobs.length === 0) {
        return;
      }

      this.logger.warn('Recovering incomplete repo index jobs on startup', {
        count: incompleteJobs.length,
      });

      for (const index of incompleteJobs) {
        // Reset to Pending (in case it was InProgress when server died)
        await this.repoIndexDao.updateById(index.id, {
          status: RepoIndexStatus.Pending,
        });

        await this.repoIndexQueueService.addIndexJob({
          repoIndexId: index.id,
          repoUrl: index.repoUrl,
        });

        this.logger.debug('Re-enqueued incomplete repo index job', {
          repoIndexId: index.id,
          previousStatus: index.status,
        });
      }
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        'Failed to recover incomplete repo index jobs',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public: main entry points called by tools
  // ---------------------------------------------------------------------------

  async getOrInitIndexForRepo(
    params: GetOrInitIndexParams,
  ): Promise<GetOrInitIndexResult> {
    let { repositoryId } = params;
    const { repoUrl, repoRoot, execFn } = params;

    // Resolve the real git_repositories record so we use its actual ID
    // instead of the caller-computed UUID. This ensures we find the existing
    // repo_indexes row and reuse it for incremental reindexing.
    const resolvedRepo = await this.resolveGitRepository(repoUrl);
    if (resolvedRepo) {
      repositoryId = resolvedRepo.id;
    }

    const existing = await this.repoIndexDao.getOne({
      repositoryId,
    });

    // If indexing is actively running, return immediately
    if (
      existing &&
      (existing.status === RepoIndexStatus.InProgress ||
        existing.status === RepoIndexStatus.Pending)
    ) {
      return { status: 'in_progress', repoIndex: existing };
    }

    // Determine current state
    const { embeddingModel, vectorSize, chunkingSignatureHash, collection } =
      await this.repoIndexerService.calculateIndexMetadata(repositoryId);
    const currentCommit = await this.repoIndexerService.resolveCurrentCommit(
      repoRoot,
      execFn,
    );

    // If completed and up-to-date, return ready
    if (existing && existing.status === RepoIndexStatus.Completed) {
      if (
        existing.lastIndexedCommit === currentCommit &&
        existing.embeddingModel === embeddingModel &&
        existing.vectorSize === vectorSize &&
        existing.chunkingSignatureHash === chunkingSignatureHash
      ) {
        return { status: 'ready', repoIndex: existing };
      }
    }

    // Decide full vs incremental
    const needsFullReindex =
      !existing ||
      existing.status === RepoIndexStatus.Failed ||
      this.needsFullReindexDueToConfigChange(existing, {
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
      });

    const lastIndexedCommit = needsFullReindex
      ? undefined
      : (existing!.lastIndexedCommit ?? undefined);

    // Estimate size to decide inline vs background
    // For incremental indexing, only estimate the changed files
    let estimatedTokens: number;
    if (needsFullReindex) {
      estimatedTokens = await this.repoIndexerService.estimateTokenCount(
        repoRoot,
        execFn,
      );
    } else {
      // Incremental: estimate only changed files
      estimatedTokens = await this.repoIndexerService.estimateChangedTokenCount(
        repoRoot,
        lastIndexedCommit!,
        currentCommit,
        execFn,
      );
    }

    const indexParams = {
      repoId: repoUrl,
      repoRoot,
      currentCommit,
      collection,
      vectorSize,
      embeddingModel,
      lastIndexedCommit,
    };

    this.logger.debug(
      'Estimated tokens calculated, deciding indexing strategy',
      {
        repoIndexId: existing?.id,
        estimatedTokens,
        threshold: environment.codebaseIndexTokenThreshold,
        willIndexInline:
          estimatedTokens <= environment.codebaseIndexTokenThreshold,
      },
    );

    // For incremental reindex, carry previous total so the progress bar stays meaningful
    const previousTotalTokens =
      !needsFullReindex && existing?.estimatedTokens
        ? existing.estimatedTokens
        : undefined;

    if (estimatedTokens <= environment.codebaseIndexTokenThreshold) {
      // Inline indexing — small repo, do it now
      this.logger.debug('Using inline indexing strategy');
      const entity = await this.upsertIndexEntity({
        existing,
        repositoryId,
        repoUrl,
        status: RepoIndexStatus.InProgress,
        qdrantCollection: collection,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        estimatedTokens,
        previousTotalTokens,
      });

      try {
        // Create a callback to update indexed token progress using atomic increment
        const onProgressUpdate = this.createProgressCallback(entity.id);

        if (needsFullReindex) {
          await this.repoIndexerService.runFullIndex(
            indexParams,
            execFn,
            undefined,
            onProgressUpdate,
          );
        } else {
          await this.repoIndexerService.runIncrementalIndex(
            indexParams,
            execFn,
            undefined,
            onProgressUpdate,
          );
        }

        // Get total tokens from Qdrant - this gives accurate count of all indexed content
        const totalIndexedTokens =
          await this.repoIndexerService.getTotalIndexedTokens(
            collection,
            repoUrl,
            embeddingModel,
          );

        await this.repoIndexDao.updateById(entity.id, {
          status: RepoIndexStatus.Completed,
          lastIndexedCommit: currentCommit,
          errorMessage: null,
          indexedTokens: totalIndexedTokens,
          estimatedTokens: totalIndexedTokens, // Update to reflect actual total
        });

        return {
          status: 'ready',
          repoIndex: {
            ...entity,
            status: RepoIndexStatus.Completed,
            lastIndexedCommit: currentCommit,
            indexedTokens: totalIndexedTokens,
            estimatedTokens: totalIndexedTokens,
          },
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        await this.repoIndexDao.updateById(entity.id, {
          status: RepoIndexStatus.Failed,
          errorMessage,
        });
        throw err;
      }
    }

    // Background indexing — large repo
    this.logger.debug('Using background indexing strategy');
    const entity = await this.upsertIndexEntity({
      existing,
      repositoryId,
      repoUrl,
      status: RepoIndexStatus.Pending,
      qdrantCollection: collection,
      embeddingModel,
      vectorSize,
      chunkingSignatureHash,
      estimatedTokens,
      previousTotalTokens,
    });

    const jobData: RepoIndexJobData = {
      repoIndexId: entity.id,
      repoUrl,
    };

    await this.repoIndexQueueService.addIndexJob(jobData);

    this.logger.debug('Repo index job enqueued', {
      repoIndexId: entity.id,
      repoUrl,
      estimatedTokens,
    });

    return { status: 'pending', repoIndex: entity };
  }

  async searchCodebase(
    params: SearchCodebaseParams,
  ): Promise<SearchCodebaseResult[]> {
    const { collection, query, repoId, topK, directoryFilter, languageFilter } =
      params;

    // Get embedding for the query
    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const queryEmbeddingResult = await this.openaiService.embeddings({
      model: embeddingModel,
      input: [query],
    });

    if (
      queryEmbeddingResult.embeddings.length === 0 ||
      !queryEmbeddingResult.embeddings[0]
    ) {
      throw new Error('Failed to generate embedding for query');
    }

    // Expand search limit to allow filtering without losing relevant results
    const SEARCH_EXPANSION_FACTOR = 4;
    const searchLimit = Math.min(
      Math.max(topK * SEARCH_EXPANSION_FACTOR, topK),
      15 * SEARCH_EXPANSION_FACTOR,
    );

    // Search Qdrant
    const matches = await this.qdrantService.searchPoints(
      collection,
      queryEmbeddingResult.embeddings[0],
      searchLimit,
      {
        filter: {
          must: [{ key: 'repo_id', match: { value: repoId } }],
        },
        with_payload: true,
      },
    );

    // Parse and filter results
    const results = matches
      .map((match) => this.parseSearchResult(match))
      .filter((match): match is SearchCodebaseResult => Boolean(match))
      .filter((match) => this.matchesPathPrefix(match, directoryFilter))
      .filter((match) => this.matchesLanguage(match, languageFilter))
      .slice(0, topK);

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private: BullMQ processor
  // ---------------------------------------------------------------------------

  private async processIndexJob(data: RepoIndexJobData): Promise<void> {
    const { repoIndexId, repoUrl } = data;

    this.logger.debug('Processing repo index job', {
      repoIndexId,
      repoUrl,
    });

    const entity = await this.repoIndexDao.getOne({ id: repoIndexId });
    if (!entity) {
      this.logger.warn('Repo index entity not found, skipping job', {
        repoIndexId,
      });
      return;
    }
    if (entity.status === RepoIndexStatus.Completed) {
      this.logger.debug('Repo index already completed, skipping job', {
        repoIndexId,
      });
      return;
    }

    await this.repoIndexDao.updateById(repoIndexId, {
      status: RepoIndexStatus.InProgress,
      errorMessage: null,
      // Preserve indexedTokens from pending state (for incremental reindex this
      // already accounts for the untouched portion set by upsertIndexEntity)
      indexedTokens: entity.indexedTokens ?? 0,
      // Preserve estimatedTokens from pending state (will be recalculated in container)
      estimatedTokens: entity.estimatedTokens,
    });

    // Use UUID namespace for system graph ID (consistent UUID for system operations)
    const graphId = '00000000-0000-0000-0000-000000000001';
    const runtimeNodeId = 'repo-indexer';
    const threadId = repoIndexId;

    let runtimeInstance: Awaited<
      ReturnType<typeof this.runtimeProvider.provide>
    > | null = null;

    try {
      this.logger.debug('Spinning up ephemeral container for repo indexing', {
        repoIndexId,
      });

      // Spin up ephemeral container
      runtimeInstance = await this.runtimeProvider.provide({
        graphId,
        runtimeNodeId,
        threadId,
        type: RuntimeType.Docker,
        temporary: true,
        runtimeStartParams: {},
      });

      this.logger.debug('Container started, beginning clone', {
        repoIndexId,
        repoUrl,
      });

      const runtime = runtimeInstance.runtime;

      const execFn: RepoExecFn = async (params) => {
        const res = await runtime.exec({
          cmd: params.cmd,
          sessionId: threadId,
          timeoutMs: 120_000,
          tailTimeoutMs: 30_000,
        });
        return {
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      };

      // Build authenticated clone URL
      const cloneUrl = await this.buildCloneUrl(repoUrl);

      // Clean up any existing repo directory from previous runs
      await execFn({
        cmd: `rm -rf ${shQuote(REPO_CLONE_DIR)}`,
      });

      // Clone repo (default branch) with depth limit to avoid OOM for very large repos
      // Depth of 100 is sufficient for most indexing needs while saving memory/time
      const cloneRes = await execFn({
        cmd: `git clone --depth 100 ${shQuote(cloneUrl)} ${shQuote(REPO_CLONE_DIR)}`,
      });
      if (cloneRes.exitCode !== 0) {
        throw new Error(`git clone failed: ${cloneRes.stderr}`);
      }

      // Resolve current state in the fresh clone
      const { embeddingModel, vectorSize, chunkingSignatureHash, collection } =
        await this.repoIndexerService.calculateIndexMetadata(
          entity.repositoryId,
        );
      const currentCommit = await this.repoIndexerService.resolveCurrentCommit(
        REPO_CLONE_DIR,
        execFn,
      );

      // Determine if full reindex is needed
      const needsFullReindex = this.needsFullReindexDueToConfigChange(entity, {
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
      });

      // Calculate estimated tokens before indexing
      const changedTokens = needsFullReindex
        ? await this.repoIndexerService.estimateTokenCount(
            REPO_CLONE_DIR,
            execFn,
          )
        : await this.repoIndexerService.estimateChangedTokenCount(
            REPO_CLONE_DIR,
            entity.lastIndexedCommit!,
            currentCommit,
            execFn,
          );

      // For incremental reindex, keep the previous total as the estimate
      // so the progress bar stays meaningful (previous total ≈ final total).
      const effectiveEstimated =
        !needsFullReindex && entity.estimatedTokens
          ? entity.estimatedTokens
          : changedTokens;

      this.logger.debug('Estimated tokens calculated for indexing', {
        repoIndexId,
        estimatedTokens: effectiveEstimated,
        needsFullReindex,
      });

      // Update metadata fields now so they're visible during indexing
      await this.repoIndexDao.updateById(repoIndexId, {
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        qdrantCollection: collection,
        estimatedTokens: effectiveEstimated,
      });

      const indexParams = {
        repoId: repoUrl,
        repoRoot: REPO_CLONE_DIR,
        currentCommit,
        collection,
        vectorSize,
        embeddingModel,
        lastIndexedCommit: needsFullReindex
          ? undefined
          : (entity.lastIndexedCommit ?? undefined),
      };

      // Create a callback to update runtime activity (keeps container alive during indexing)
      const updateRuntimeActivity = async () => {
        await this.updateRuntimeLastUsedAt(graphId, runtimeNodeId, threadId);
      };

      // Create a callback to update indexed token progress using atomic increment
      const onProgressUpdate = this.createProgressCallback(repoIndexId);

      if (needsFullReindex) {
        await this.repoIndexerService.runFullIndex(
          indexParams,
          execFn,
          updateRuntimeActivity,
          onProgressUpdate,
        );
      } else {
        await this.repoIndexerService.runIncrementalIndex(
          indexParams,
          execFn,
          updateRuntimeActivity,
          onProgressUpdate,
        );
      }

      // Get total tokens from Qdrant - this gives accurate count of all indexed content
      const totalIndexedTokens =
        await this.repoIndexerService.getTotalIndexedTokens(
          collection,
          repoUrl,
          embeddingModel,
        );

      await this.repoIndexDao.updateById(repoIndexId, {
        status: RepoIndexStatus.Completed,
        lastIndexedCommit: currentCommit,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        qdrantCollection: collection,
        errorMessage: null,
        indexedTokens: totalIndexedTokens,
        estimatedTokens: totalIndexedTokens, // Update to reflect actual total
      });

      this.logger.debug('Repo index job completed', {
        repoIndexId,
        currentCommit,
        indexedTokens: totalIndexedTokens,
      });
    } finally {
      // Cleanup ephemeral container
      if (runtimeInstance) {
        await this.runtimeProvider
          .cleanupRuntimeInstance({
            graphId,
            runtimeNodeId,
            threadId,
            type: RuntimeType.Docker,
          })
          .catch((err) => {
            this.logger.warn(
              'Failed to cleanup runtime instance after indexing',
              {
                graphId,
                runtimeNodeId,
                threadId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: helpers
  // ---------------------------------------------------------------------------

  private static readonly LOG_TOKEN_INTERVAL = 50_000;

  /**
   * Creates a progress callback for indexing operations.
   * Uses atomic increment to avoid race conditions when batches complete concurrently.
   * Logs progress at intervals to reduce noise.
   */
  private createProgressCallback(
    repoIndexId: string,
  ): (tokenCount: number) => Promise<void> {
    let totalTokensProcessed = 0;
    let lastLoggedThreshold = 0;

    return async (tokenCount: number) => {
      // Atomically increment the token counter in DB
      await this.repoIndexDao.incrementIndexedTokens(repoIndexId, tokenCount);

      // Track locally for logging decisions (approximate is fine for logging)
      totalTokensProcessed += tokenCount;

      // Log when we cross a new threshold
      const currentThreshold =
        Math.floor(totalTokensProcessed / RepoIndexService.LOG_TOKEN_INTERVAL) *
        RepoIndexService.LOG_TOKEN_INTERVAL;

      if (currentThreshold > lastLoggedThreshold) {
        this.logger.debug('Indexing progress updated', {
          repoIndexId,
          approximateTokens: totalTokensProcessed,
        });
        lastLoggedThreshold = currentThreshold;
      }
    };
  }

  /**
   * Updates the runtime instance's lastUsedAt timestamp to prevent cleanup
   * during long-running indexing operations
   */
  private async updateRuntimeLastUsedAt(
    graphId: string,
    nodeId: string,
    threadId: string,
  ): Promise<void> {
    try {
      const instance = await this.runtimeInstanceDao.getOne({
        graphId,
        nodeId,
        threadId,
      });

      if (instance) {
        await this.runtimeInstanceDao.updateById(instance.id, {
          lastUsedAt: new Date(),
        });
      }
    } catch (error) {
      // Don't fail indexing if we can't update lastUsedAt
      this.logger.warn('Failed to update runtime lastUsedAt', {
        graphId,
        nodeId,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Determines if a full reindex is needed due to config changes.
   * Does NOT check for entity existence or status - caller handles those.
   */
  private needsFullReindexDueToConfigChange(
    entity: {
      lastIndexedCommit: string | null;
      embeddingModel: string | null;
      vectorSize: number | null;
      chunkingSignatureHash: string | null;
    },
    currentConfig: {
      embeddingModel: string;
      vectorSize: number;
      chunkingSignatureHash: string;
    },
  ): boolean {
    return (
      !entity.lastIndexedCommit ||
      entity.embeddingModel !== currentConfig.embeddingModel ||
      entity.vectorSize !== currentConfig.vectorSize ||
      entity.chunkingSignatureHash !== currentConfig.chunkingSignatureHash
    );
  }

  /**
   * Try to find the real GitRepositoryEntity by parsing owner/repo from a URL.
   * Returns null if the URL can't be parsed or no matching record exists.
   */
  private async resolveGitRepository(
    repoUrl: string,
  ): Promise<GitRepositoryEntity | null> {
    try {
      const url = new URL(repoUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const owner = pathParts[0];
        const repo = pathParts[1]?.replace(/\.git$/, '');
        if (owner && repo) {
          return await this.gitRepositoriesDao.getOne({ owner, repo });
        }
      }
    } catch {
      // Not a valid URL (e.g. local:... paths), fall through
    }
    return null;
  }

  private async buildCloneUrl(repoUrl: string): Promise<string> {
    // Try to find credentials for this repo
    try {
      const url = new URL(repoUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        const owner = pathParts[0];
        // Strip .git suffix if present
        const repo = pathParts[1]?.replace(/\.git$/, '');
        const gitRepo = await this.gitRepositoriesDao.getOne({ owner, repo });
        if (gitRepo?.encryptedToken) {
          const token = this.gitRepositoriesService.decryptCredential(
            gitRepo.encryptedToken,
          );
          // Inject token into URL: https://token@host/owner/repo
          url.username = token;
          return url.toString();
        }
      }
    } catch (error) {
      // If URL parsing or credential lookup fails, fall back to unauthenticated
      this.logger.debug('Failed to build authenticated clone URL', {
        repoUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return repoUrl;
  }

  private async upsertIndexEntity(params: {
    existing: RepoIndexEntity | null;
    repositoryId: string;
    repoUrl: string;
    status: RepoIndexStatus;
    qdrantCollection: string;
    embeddingModel: string;
    vectorSize: number;
    chunkingSignatureHash: string;
    estimatedTokens: number;
    /** For incremental reindex: carry over the previous total as estimatedTokens
     *  and set indexedTokens to (previousTotal - changedEstimate) instead of 0. */
    previousTotalTokens?: number;
  }): Promise<RepoIndexEntity> {
    // For incremental reindex keep the previous total as the estimate
    // and set indexedTokens to the untouched portion so progress starts close to max.
    const effectiveEstimated =
      params.previousTotalTokens ?? params.estimatedTokens;
    const effectiveIndexed = params.previousTotalTokens
      ? Math.max(0, params.previousTotalTokens - params.estimatedTokens)
      : 0;

    const payload = {
      status: params.status,
      qdrantCollection: params.qdrantCollection,
      embeddingModel: params.embeddingModel,
      vectorSize: params.vectorSize,
      chunkingSignatureHash: params.chunkingSignatureHash,
      estimatedTokens: effectiveEstimated,
      indexedTokens: effectiveIndexed,
      errorMessage: null,
    };

    if (params.existing) {
      await this.repoIndexDao.updateById(params.existing.id, payload);
      return { ...params.existing, ...payload } as RepoIndexEntity;
    }

    return this.repoIndexDao.create({
      repositoryId: params.repositoryId,
      repoUrl: params.repoUrl,
      lastIndexedCommit: null,
      ...payload,
    });
  }

  private parseSearchResult(
    match: Awaited<ReturnType<QdrantService['searchPoints']>>[number],
  ): SearchCodebaseResult | null {
    const payload = (match.payload ?? {}) as Partial<{
      repo_id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
    }>;

    if (!payload.path || !payload.text) {
      return null;
    }

    const startLine = Number(payload.start_line ?? 1);
    const endLine = Number(payload.end_line ?? startLine);

    return {
      path: String(payload.path),
      start_line: Number.isFinite(startLine) ? startLine : 1,
      end_line: Number.isFinite(endLine) ? endLine : startLine,
      text: String(payload.text),
      score: match.score ?? 0,
    };
  }

  private matchesPathPrefix(
    match: SearchCodebaseResult,
    directory?: string,
  ): boolean {
    if (!directory) {
      return true;
    }

    const normalized = directory.replace(/\\/g, '/').replace(/^\/+/, '');
    const withoutSlash = normalized.replace(/\/+$/, '');

    if (!withoutSlash) {
      return true;
    }

    return (
      match.path === withoutSlash || match.path.startsWith(`${withoutSlash}/`)
    );
  }

  private matchesLanguage(
    match: SearchCodebaseResult,
    language?: string,
  ): boolean {
    if (!language) {
      return true;
    }

    const normalized = language.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    const extension = match.path.split('.').pop()?.toLowerCase();

    return extension === normalized;
  }
}
