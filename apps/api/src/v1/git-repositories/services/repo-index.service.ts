import { Injectable, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { environment } from '../../../environments';
import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import {
  CompleteJsonData,
  OpenaiService,
  ResponseJsonData,
} from '../../openai/openai.service';
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
const GIT_CLONE_DEPTH = 100;

const EMBEDDING_CACHE_MAX_SIZE = 200;
const EMBEDDING_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Minimum topK to trigger query expansion — small queries don't benefit
const QUERY_EXPANSION_MIN_TOP_K = 5;

const CodeSearchQueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});

type CachedEmbedding = { embedding: number[]; timestamp: number };

@Injectable()
export class RepoIndexService implements OnModuleInit {
  private readonly embeddingCache = new Map<string, CachedEmbedding>();

  constructor(
    private readonly repoIndexDao: RepoIndexDao,
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly gitRepositoriesService: GitRepositoriesService,
    private readonly repoIndexerService: RepoIndexerService,
    private readonly repoIndexQueueService: RepoIndexQueueService,
    private readonly litellmService: LitellmService,
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
      onRetry: this.handleRetryJob.bind(this),
      onFailed: this.handleFailedJob.bind(this),
    });
    await this.recoverStuckJobs();
    await this.cleanupOrphanedIndexes();
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
   * Called when a job fails but will be retried by BullMQ.
   * Resets entity to Pending so it doesn't appear stuck as InProgress
   * while waiting for the retry.
   */
  private async handleRetryJob(
    repoIndexId: string,
    error: Error,
  ): Promise<void> {
    this.logger.warn('Repo index job failed, will be retried', {
      repoIndexId,
      error: error.message,
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
          branch: index.branch,
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

  /**
   * On server startup, remove orphaned Qdrant collections, orphaned DB rows,
   * and stale indexes that haven't been updated within the configured threshold.
   */
  private async cleanupOrphanedIndexes(): Promise<void> {
    try {
      const maxAgeDays = environment.codebaseIndexMaxAgeDays;
      const staleThreshold = new Date(
        Date.now() - maxAgeDays * 24 * 60 * 60 * 1000,
      );

      // 1. Fetch all codebase_* Qdrant collections and all DB rows
      const qdrantResult = await this.qdrantService.raw.getCollections();
      const codebaseCollections = qdrantResult.collections
        .map((c) => c.name)
        .filter((name) => name.startsWith('codebase_'));

      const allIndexes = await this.repoIndexDao.getAll({});

      const dbCollectionNames = new Set(
        allIndexes
          .map((i) => i.qdrantCollection)
          .filter((name): name is string => Boolean(name)),
      );
      const qdrantCollectionNames = new Set(codebaseCollections);

      // 2. Delete orphaned Qdrant collections (no matching DB row)
      for (const collection of codebaseCollections) {
        if (!dbCollectionNames.has(collection)) {
          try {
            await this.qdrantService.raw.deleteCollection(collection);
            this.logger.warn('Deleted orphaned Qdrant collection', {
              collection,
            });
          } catch (err) {
            this.logger.warn('Failed to delete orphaned Qdrant collection', {
              collection,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // 3. Identify indexes to delete (orphaned or stale)
      const indexesToDelete: { index: RepoIndexEntity; reason: string }[] = [];
      for (const index of allIndexes) {
        // Skip in-progress/pending — collection may not be created yet
        if (
          index.status === RepoIndexStatus.InProgress ||
          index.status === RepoIndexStatus.Pending
        ) {
          continue;
        }

        const isOrphaned =
          index.qdrantCollection &&
          !qdrantCollectionNames.has(index.qdrantCollection);
        const isStale = index.updatedAt < staleThreshold;

        if (isOrphaned) {
          indexesToDelete.push({ index, reason: 'orphaned' });
        } else if (isStale) {
          indexesToDelete.push({ index, reason: 'stale' });
        }
      }

      // Build set of collections still referenced by surviving (non-deleted) rows
      const deletedIds = new Set(indexesToDelete.map((e) => e.index.id));
      const survivingCollections = new Set(
        allIndexes
          .filter((i) => !deletedIds.has(i.id) && i.qdrantCollection)
          .map((i) => i.qdrantCollection),
      );

      // 4. Execute deletions
      for (const { index, reason } of indexesToDelete) {
        // Delete the Qdrant collection only if no surviving row still references it
        if (
          index.qdrantCollection &&
          qdrantCollectionNames.has(index.qdrantCollection) &&
          !survivingCollections.has(index.qdrantCollection)
        ) {
          try {
            await this.qdrantService.raw.deleteCollection(
              index.qdrantCollection,
            );
          } catch (err) {
            this.logger.warn(
              'Failed to delete Qdrant collection for stale index',
              {
                collection: index.qdrantCollection,
                repoIndexId: index.id,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }

        // Cancel any pending BullMQ job
        await this.repoIndexQueueService.removeJob(index.id);

        // Delete the DB row
        await this.repoIndexDao.deleteById(index.id);
        this.logger.warn(`Deleted ${reason} repo index`, {
          repoIndexId: index.id,
          qdrantCollection: index.qdrantCollection,
          updatedAt: index.updatedAt,
        });
      }
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        'Failed to cleanup orphaned indexes',
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
    const { repoRoot, execFn, branch, userId } = params;

    // Resolve the real git_repositories record so we use its actual ID
    // instead of the caller-computed UUID. This ensures we find the existing
    // repo_indexes row and reuse it for incremental reindexing.
    const resolvedRepo = await this.resolveGitRepository(
      params.repoUrl,
      userId,
    );
    if (resolvedRepo) {
      repositoryId = resolvedRepo.id;
    }

    // Acquire an advisory lock on (repositoryId, branch) to prevent two
    // concurrent agents from both deciding "no existing index → create one".
    // The lock covers only the check + claim phase; actual indexing runs after
    // the lock is released.
    const claim = await this.repoIndexDao.withIndexLock(
      repositoryId,
      branch,
      () =>
        this.claimIndexSlot(
          repositoryId,
          params.repoUrl,
          branch,
          execFn,
          repoRoot,
        ),
    );

    if (claim.earlyReturn) {
      return claim.earlyReturn;
    }

    // Destructure the claimed slot — we now own the entity with InProgress/Pending status
    const { entity, repoUrl, needsFullReindex, indexParams, estimatedTokens } =
      claim;

    if (estimatedTokens <= environment.codebaseIndexTokenThreshold) {
      // Inline indexing — small repo, do it now
      this.logger.debug('Using inline indexing strategy');

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

        // Read the DB counter (maintained via atomic increments during indexing)
        // instead of scanning all Qdrant points — much cheaper for large repos.
        const updatedEntity = await this.repoIndexDao.getOne({
          id: entity.id,
        });
        const totalIndexedTokens = updatedEntity?.indexedTokens ?? 0;

        await this.repoIndexDao.updateById(entity.id, {
          status: RepoIndexStatus.Completed,
          lastIndexedCommit: indexParams.currentCommit,
          errorMessage: null,
          estimatedTokens: totalIndexedTokens,
        });

        return {
          status: 'ready',
          repoIndex: {
            ...entity,
            status: RepoIndexStatus.Completed,
            lastIndexedCommit: indexParams.currentCommit,
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

    // Switch entity to Pending since we claimed it as InProgress in the lock
    await this.repoIndexDao.updateById(entity.id, {
      status: RepoIndexStatus.Pending,
    });

    const jobData: RepoIndexJobData = {
      repoIndexId: entity.id,
      repoUrl,
      branch,
    };

    await this.repoIndexQueueService.addIndexJob(jobData);

    this.logger.debug('Repo index job enqueued', {
      repoIndexId: entity.id,
      repoUrl,
      estimatedTokens,
    });

    return {
      status: 'pending',
      repoIndex: { ...entity, status: RepoIndexStatus.Pending },
    };
  }

  /**
   * Runs inside the advisory lock. Checks existing state, calculates metadata,
   * and creates/updates the entity to "claim" the indexing slot.
   * Returns either an early result (already done / in progress) or the claimed
   * entity + indexing parameters for the caller to execute outside the lock.
   */
  private async claimIndexSlot(
    repositoryId: string,
    originalRepoUrl: string,
    branch: string,
    execFn: RepoExecFn,
    repoRoot: string,
  ): Promise<
    | { earlyReturn: GetOrInitIndexResult }
    | {
        earlyReturn?: undefined;
        entity: RepoIndexEntity;
        repoUrl: string;
        needsFullReindex: boolean;
        indexParams: {
          repoId: string;
          repoRoot: string;
          currentCommit: string;
          collection: string;
          vectorSize: number;
          embeddingModel: string;
          lastIndexedCommit?: string;
        };
        estimatedTokens: number;
      }
  > {
    // Normalize the URL so the Qdrant repo_id is always consistent
    // (strips .git suffix, converts SSH to HTTPS, etc.)
    let repoUrl = this.repoIndexerService.deriveRepoId(originalRepoUrl);

    const existing = await this.repoIndexDao.getOne({
      repositoryId,
      branch,
    });

    // Use the existing index's repoUrl to keep the Qdrant repo_id filter
    // consistent between old and new points (e.g. URL with/without .git suffix).
    if (existing) {
      repoUrl = existing.repoUrl;
    }

    // If indexing is actively running, return immediately
    if (
      existing &&
      (existing.status === RepoIndexStatus.InProgress ||
        existing.status === RepoIndexStatus.Pending)
    ) {
      return { earlyReturn: { status: 'in_progress', repoIndex: existing } };
    }

    // Determine current state
    const { embeddingModel, vectorSize, chunkingSignatureHash, collection } =
      await this.repoIndexerService.calculateIndexMetadata(
        repositoryId,
        branch,
      );
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
        return { earlyReturn: { status: 'ready', repoIndex: existing } };
      }
    }

    const strategy = await this.resolveIndexStrategy(
      existing,
      repositoryId,
      repoRoot,
      execFn,
      collection,
      currentCommit,
      { embeddingModel, vectorSize, chunkingSignatureHash },
    );

    const { needsFullReindex, lastIndexedCommit, estimatedTokens } = strategy;

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
      !needsFullReindex && existing && existing.estimatedTokens > 0
        ? existing.estimatedTokens
        : undefined;

    // Claim the slot by upserting the entity with InProgress status.
    // Any concurrent caller that arrives here will see InProgress and bail out.
    const entity = await this.upsertIndexEntity({
      existing,
      repositoryId,
      repoUrl,
      branch,
      status: RepoIndexStatus.InProgress,
      qdrantCollection: collection,
      embeddingModel,
      vectorSize,
      chunkingSignatureHash,
      estimatedTokens,
      previousTotalTokens,
    });

    return {
      entity,
      repoUrl,
      needsFullReindex,
      indexParams: {
        repoId: repoUrl,
        repoRoot,
        currentCommit,
        collection,
        vectorSize,
        embeddingModel,
        lastIndexedCommit,
      },
      estimatedTokens,
    };
  }

  async searchCodebase(
    params: SearchCodebaseParams,
  ): Promise<SearchCodebaseResult[]> {
    const {
      collection,
      query,
      repoId,
      topK,
      directoryFilter,
      languageFilter,
      minScore,
    } = params;

    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();

    // For focused queries (low topK) use a single embedding; for broader
    // searches, expand the query into variants for better recall.
    const useExpansion = topK >= QUERY_EXPANSION_MIN_TOP_K;
    const queries = useExpansion
      ? await this.generateCodeSearchVariants(query)
      : [query];

    // Embed all query variants in a single batch call (leveraging the cache
    // for any repeated text).
    const embeddings = await Promise.all(
      queries.map((q) => this.getOrComputeEmbedding(embeddingModel, q)),
    );

    // Expand search limit to allow post-filtering without losing relevant results.
    const SEARCH_EXPANSION_FACTOR = 4;
    const searchLimit = topK * SEARCH_EXPANSION_FACTOR;
    const repoFilter = this.repoIndexerService.buildRepoFilter(repoId);

    // Search Qdrant — return empty if collection was deleted between indexing and search
    type SearchResultItem = Awaited<
      ReturnType<QdrantService['searchPoints']>
    >[number];
    let allMatches: SearchResultItem[];
    try {
      if (embeddings.length === 1) {
        allMatches = await this.qdrantService.searchPoints(
          collection,
          embeddings[0]!,
          searchLimit,
          { filter: repoFilter, with_payload: true },
        );
      } else {
        const batchResults = await this.qdrantService.searchMany(
          collection,
          embeddings.map((vector) => ({
            vector,
            limit: searchLimit,
            filter: repoFilter,
            with_payload: true,
            with_vector: false,
          })),
        );
        // Deduplicate by point ID, keeping the highest score
        const bestByPointId = new Map<string | number, SearchResultItem>();
        for (const results of batchResults) {
          for (const match of results) {
            const existing = bestByPointId.get(match.id);
            if (!existing || match.score > existing.score) {
              bestByPointId.set(match.id, match);
            }
          }
        }
        allMatches = Array.from(bestByPointId.values()).sort(
          (a, b) => b.score - a.score,
        );
      }
    } catch (error) {
      if (QdrantService.isCollectionNotFoundError(error)) {
        this.logger.warn('Qdrant collection not found during search', {
          collection,
          repoId,
        });
        return [];
      }
      throw error;
    }

    // Parse and filter results
    const results = allMatches
      .map((match) => this.parseSearchResult(match))
      .filter((match): match is SearchCodebaseResult => Boolean(match))
      .filter((match) => (minScore ? match.score >= minScore : true))
      .filter((match) => this.matchesPathPrefix(match, directoryFilter))
      .filter((match) => this.matchesLanguage(match, languageFilter))
      .slice(0, topK);

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private: BullMQ processor
  // ---------------------------------------------------------------------------

  private async processIndexJob(data: RepoIndexJobData): Promise<void> {
    const { repoIndexId, branch } = data;
    // Normalize so the Qdrant repo_id is consistent regardless of source
    const repoUrl = this.repoIndexerService.deriveRepoId(data.repoUrl);

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
      indexedTokens: entity.indexedTokens,
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

      // Build authenticated clone URL using the repository entity's token
      const gitRepo = await this.gitRepositoriesDao.getOne({
        id: entity.repositoryId,
      });
      const cloneUrl = this.buildCloneUrlFromEntity(repoUrl, gitRepo);

      // Clean up any existing repo directory from previous runs
      await execFn({
        cmd: `rm -rf ${shQuote(REPO_CLONE_DIR)}`,
      });

      // Clone repo with depth limit to avoid OOM for very large repos
      const branchFlag = branch ? `--branch ${shQuote(branch)} ` : '';
      const cloneRes = await execFn({
        cmd: `git clone --depth ${GIT_CLONE_DEPTH} ${branchFlag}${shQuote(cloneUrl)} ${shQuote(REPO_CLONE_DIR)}`,
      });
      if (cloneRes.exitCode !== 0) {
        throw new Error(
          `git clone failed: ${RepoIndexService.sanitizeUrl(cloneRes.stderr)}`,
        );
      }

      // Resolve current state in the fresh clone
      const { embeddingModel, vectorSize, chunkingSignatureHash, collection } =
        await this.repoIndexerService.calculateIndexMetadata(
          entity.repositoryId,
          branch,
        );
      const currentCommit = await this.repoIndexerService.resolveCurrentCommit(
        REPO_CLONE_DIR,
        execFn,
      );

      const strategy = await this.resolveIndexStrategy(
        entity,
        entity.repositoryId,
        REPO_CLONE_DIR,
        execFn,
        collection,
        currentCommit,
        { embeddingModel, vectorSize, chunkingSignatureHash },
      );

      const { needsFullReindex, lastIndexedCommit } = strategy;

      // For incremental reindex, keep the previous total as the estimate
      // so the progress bar stays meaningful (previous total ≈ final total).
      const effectiveEstimated =
        !needsFullReindex && entity.estimatedTokens > 0
          ? entity.estimatedTokens
          : strategy.estimatedTokens;

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
        lastIndexedCommit,
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

      // Read the DB counter (maintained via atomic increments during indexing)
      // instead of scanning all Qdrant points — much cheaper for large repos.
      const updatedEntity = await this.repoIndexDao.getOne({
        id: repoIndexId,
      });
      const totalIndexedTokens = updatedEntity?.indexedTokens ?? 0;

      await this.repoIndexDao.updateById(repoIndexId, {
        status: RepoIndexStatus.Completed,
        lastIndexedCommit: currentCommit,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        qdrantCollection: collection,
        errorMessage: null,
        estimatedTokens: totalIndexedTokens,
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
   * Shared logic to determine full vs incremental indexing, attempt cross-branch
   * seeding, and estimate token counts. Used by both claimIndexSlot (inline) and
   * processIndexJob (background) to avoid duplicating this decision tree.
   */
  private async resolveIndexStrategy(
    existing: RepoIndexEntity | null,
    repositoryId: string,
    repoRoot: string,
    execFn: RepoExecFn,
    collection: string,
    currentCommit: string,
    config: {
      embeddingModel: string;
      vectorSize: number;
      chunkingSignatureHash: string;
    },
  ): Promise<{
    needsFullReindex: boolean;
    lastIndexedCommit?: string;
    estimatedTokens: number;
  }> {
    let needsFullReindex =
      !existing ||
      existing.status === RepoIndexStatus.Failed ||
      this.needsFullReindexDueToConfigChange(existing, config);

    // Cross-branch seeding: when no index exists (or no last commit),
    // copy points from a sibling branch
    let donorCommit: string | undefined;
    if (needsFullReindex && !existing?.lastIndexedCommit) {
      const seeding = await this.attemptCrossBranchSeeding(
        repositoryId,
        collection,
      );
      if (seeding.seeded) {
        donorCommit = seeding.donorCommit;
        needsFullReindex = false;
      }
    }

    const lastIndexedCommit = needsFullReindex
      ? undefined
      : (existing?.lastIndexedCommit ?? donorCommit ?? undefined);

    let estimatedTokens: number;
    if (needsFullReindex || !lastIndexedCommit) {
      estimatedTokens = await this.repoIndexerService.estimateTokenCount(
        repoRoot,
        execFn,
      );
    } else {
      estimatedTokens = await this.repoIndexerService.estimateChangedTokenCount(
        repoRoot,
        lastIndexedCommit,
        currentCommit,
        execFn,
      );
    }

    return { needsFullReindex, lastIndexedCommit, estimatedTokens };
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
   * Strip embedded credentials (e.g. `token@` or `user:pass@`) from URLs
   * so they don't leak into log entries or error messages.
   */
  private static sanitizeUrl(text: string): string {
    return text.replace(/\/\/[^@/]+@/g, '//');
  }

  /**
   * Parse owner/repo from a git URL. Returns null for non-URL strings
   * (e.g. `local:…` paths) or URLs with fewer than two path segments.
   */
  private static parseOwnerRepo(
    repoUrl: string,
  ): { url: URL; owner: string; repo: string } | null {
    try {
      const url = new URL(repoUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length < 2) return null;
      const owner = pathParts[0];
      const repo = pathParts[1]?.replace(/\.git$/, '');
      if (!owner || !repo) return null;
      return { url, owner, repo };
    } catch {
      return null;
    }
  }

  /**
   * Try to find the real GitRepositoryEntity by parsing owner/repo from a URL.
   * Scopes the lookup to a specific user when `createdBy` is provided to avoid
   * cross-user data leakage.
   * Returns null if the URL can't be parsed or no matching record exists.
   */
  private async resolveGitRepository(
    repoUrl: string,
    createdBy?: string,
  ): Promise<GitRepositoryEntity | null> {
    const parsed = RepoIndexService.parseOwnerRepo(repoUrl);
    if (!parsed) return null;

    const searchParams: { owner: string; repo: string; createdBy?: string } = {
      owner: parsed.owner,
      repo: parsed.repo,
    };
    if (createdBy) {
      searchParams.createdBy = createdBy;
    }
    return this.gitRepositoriesDao.getOne(searchParams);
  }

  /**
   * Build an authenticated clone URL when the git repository entity is
   * already available. Avoids an extra DB lookup.
   */
  private buildCloneUrlFromEntity(
    repoUrl: string,
    gitRepo: GitRepositoryEntity | null,
  ): string {
    if (!gitRepo?.encryptedToken) return repoUrl;

    const parsed = RepoIndexService.parseOwnerRepo(repoUrl);
    if (!parsed) return repoUrl;

    try {
      const token = this.gitRepositoriesService.decryptCredential(
        gitRepo.encryptedToken,
      );
      parsed.url.username = token;
      return parsed.url.toString();
    } catch (error) {
      this.logger.debug('Failed to build authenticated clone URL', {
        repoUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return repoUrl;
  }

  /**
   * Try to seed a new branch index by copying points from an existing
   * completed index on a sibling branch. Extracted to avoid duplicating
   * the donor-finding logic between inline and background indexing paths.
   */
  private async attemptCrossBranchSeeding(
    repositoryId: string,
    targetCollection: string,
  ): Promise<{ seeded: boolean; donorCommit?: string }> {
    const donors = await this.repoIndexDao.getAll({
      repositoryId,
      status: RepoIndexStatus.Completed,
      limit: 1,
      order: { updatedAt: 'DESC' },
    });
    const donor = donors[0];

    if (!donor?.lastIndexedCommit || !donor.qdrantCollection) {
      return { seeded: false };
    }

    this.logger.debug('Seeding new branch index from donor', {
      repositoryId,
      donorCollection: donor.qdrantCollection,
      donorCommit: donor.lastIndexedCommit,
    });

    await this.repoIndexerService.copyCollectionPoints(
      donor.qdrantCollection,
      targetCollection,
    );

    return { seeded: true, donorCommit: donor.lastIndexedCommit };
  }

  private async upsertIndexEntity(params: {
    existing: RepoIndexEntity | null;
    repositoryId: string;
    repoUrl: string;
    branch: string;
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
      branch: params.branch,
      lastIndexedCommit: null,
      ...payload,
    });
  }

  /**
   * Generate alternative search queries for code search to improve recall.
   * Uses an LLM to rephrase the original query into code-oriented variants
   * (function names, class names, file paths, etc.).
   */
  private async generateCodeSearchVariants(query: string): Promise<string[]> {
    try {
      const prompt = [
        'Generate 3-5 short search queries or keyword phrases for finding relevant code in a repository.',
        'Return ONLY JSON with key "queries": string[].',
        'Rules:',
        '- Include the original query verbatim.',
        '- Include variants that use likely function/class/variable names.',
        '- Include variants that describe the code pattern or file type.',
        '- Keep each query under 12 words.',
        '- Deduplicate queries.',
        '',
        `QUERY: ${query}`,
      ].join('\n');

      const modelName = this.llmModelsService.getKnowledgeSearchModel();
      const supportsResponsesApi =
        await this.litellmService.supportsResponsesApi(modelName);
      const data: ResponseJsonData | CompleteJsonData = {
        model: modelName,
        message: prompt,
        json: true as const,
        jsonSchema: CodeSearchQueryExpansionSchema,
      };
      const response = supportsResponsesApi
        ? await this.openaiService.response<{ queries: string[] }>(data)
        : await this.openaiService.complete<{ queries: string[] }>(data);

      const validation = CodeSearchQueryExpansionSchema.safeParse(
        response.content,
      );
      if (!validation.success) {
        return [query];
      }

      const unique = new Set<string>();
      unique.add(query);
      for (const item of validation.data.queries) {
        const normalized = item.trim();
        if (normalized) unique.add(normalized);
      }

      return Array.from(unique).slice(0, 5);
    } catch (error) {
      this.logger.warn('Failed to expand code search query, using original', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [query];
    }
  }

  private async getOrComputeEmbedding(
    model: string,
    text: string,
  ): Promise<number[]> {
    const cacheKey = `${model}:${text}`;
    const cached = this.embeddingCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < EMBEDDING_CACHE_TTL_MS) {
      return cached.embedding;
    }

    const result = await this.openaiService.embeddings({
      model,
      input: [text],
    });

    if (result.embeddings.length === 0 || !result.embeddings[0]) {
      throw new Error('Failed to generate embedding for query');
    }

    const embedding = result.embeddings[0];

    // Evict oldest entries when cache is full
    if (this.embeddingCache.size >= EMBEDDING_CACHE_MAX_SIZE) {
      const firstKey = this.embeddingCache.keys().next().value;
      if (firstKey !== undefined) {
        this.embeddingCache.delete(firstKey);
      }
    }

    this.embeddingCache.set(cacheKey, { embedding, timestamp: now });
    return embedding;
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

  /** Maps common language names to file extensions for flexible filtering. */
  private static readonly LANGUAGE_TO_EXTENSIONS: Record<string, string[]> = {
    typescript: ['ts', 'tsx'],
    javascript: ['js', 'jsx', 'mjs', 'cjs'],
    python: ['py', 'pyw'],
    rust: ['rs'],
    golang: ['go'],
    go: ['go'],
    java: ['java'],
    kotlin: ['kt', 'kts'],
    swift: ['swift'],
    ruby: ['rb'],
    csharp: ['cs'],
    'c#': ['cs'],
    'c++': ['cpp', 'cc', 'cxx', 'hpp', 'hxx', 'h'],
    cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hxx', 'h'],
    c: ['c', 'h'],
    php: ['php'],
    scala: ['scala'],
    shell: ['sh', 'bash', 'zsh'],
    bash: ['sh', 'bash'],
    html: ['html', 'htm'],
    css: ['css', 'scss', 'sass', 'less'],
    sql: ['sql'],
    yaml: ['yaml', 'yml'],
    json: ['json'],
    markdown: ['md', 'mdx'],
    vue: ['vue'],
    svelte: ['svelte'],
    dart: ['dart'],
    elixir: ['ex', 'exs'],
    haskell: ['hs'],
    lua: ['lua'],
    zig: ['zig'],
  };

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
    if (!extension) {
      return false;
    }

    // First try direct extension match (e.g. "ts", "py")
    if (extension === normalized) {
      return true;
    }

    // Then try language name → extensions mapping (e.g. "typescript" → ["ts", "tsx"])
    const mappedExtensions =
      RepoIndexService.LANGUAGE_TO_EXTENSIONS[normalized];
    if (mappedExtensions) {
      return mappedExtensions.includes(extension);
    }

    return false;
  }
}
