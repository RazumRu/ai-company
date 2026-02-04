import { Injectable, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { RuntimeType } from '../../runtime/runtime.types';
import { RuntimeProvider } from '../../runtime/services/runtime-provider';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
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
    private readonly logger: DefaultLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    this.repoIndexQueueService.setProcessor(this.processIndexJob.bind(this));
  }

  // ---------------------------------------------------------------------------
  // Public: main entry points called by tools
  // ---------------------------------------------------------------------------

  async getOrInitIndexForRepo(
    params: GetOrInitIndexParams,
  ): Promise<GetOrInitIndexResult> {
    const { repositoryId, repoUrl, repoRoot, execFn } = params;

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
    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const vectorSize =
      await this.repoIndexerService.getVectorSizeForModel(embeddingModel);
    const currentCommit = await this.repoIndexerService.resolveCurrentCommit(
      repoRoot,
      execFn,
    );
    const chunkingSignatureHash =
      this.repoIndexerService.getChunkingSignatureHash();
    const repoSlug = this.repoIndexerService.deriveRepoSlug(repositoryId);
    const collection = this.repoIndexerService.buildCollectionName(
      repoSlug,
      vectorSize,
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
      existing.embeddingModel !== embeddingModel ||
      existing.vectorSize !== vectorSize ||
      existing.chunkingSignatureHash !== chunkingSignatureHash;

    const lastIndexedCommit = needsFullReindex
      ? undefined
      : (existing!.lastIndexedCommit ?? undefined);

    // Estimate size to decide inline vs background
    const estimatedTokens = await this.repoIndexerService.estimateTokenCount(
      repoRoot,
      execFn,
    );

    const indexParams = {
      repoId: repoUrl,
      repoRoot,
      currentCommit,
      collection,
      vectorSize,
      embeddingModel,
      lastIndexedCommit,
    };

    if (estimatedTokens <= environment.codebaseIndexTokenThreshold) {
      // Inline indexing — small repo, do it now
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
      });

      try {
        if (needsFullReindex) {
          await this.repoIndexerService.runFullIndex(indexParams, execFn);
        } else {
          await this.repoIndexerService.runIncrementalIndex(
            indexParams,
            execFn,
          );
        }

        await this.repoIndexDao.updateById(entity.id, {
          status: RepoIndexStatus.Completed,
          lastIndexedCommit: currentCommit,
          errorMessage: null,
        });

        return {
          status: 'ready',
          repoIndex: {
            ...entity,
            status: RepoIndexStatus.Completed,
            lastIndexedCommit: currentCommit,
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
    });

    const graphId = 'system-repo-indexing';
    const runtimeNodeId = 'repo-indexer';
    const threadId = repoIndexId;

    let runtimeInstance: Awaited<
      ReturnType<typeof this.runtimeProvider.provide>
    > | null = null;

    try {
      // Spin up ephemeral container
      runtimeInstance = await this.runtimeProvider.provide({
        graphId,
        runtimeNodeId,
        threadId,
        type: RuntimeType.Docker,
        temporary: true,
        runtimeStartParams: {},
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

      // Clone repo (default branch)
      const cloneRes = await execFn({
        cmd: `git clone ${shQuote(cloneUrl)} ${shQuote(REPO_CLONE_DIR)}`,
      });
      if (cloneRes.exitCode !== 0) {
        throw new Error(`git clone failed: ${cloneRes.stderr}`);
      }

      // Resolve current state in the fresh clone
      const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
      const vectorSize =
        await this.repoIndexerService.getVectorSizeForModel(embeddingModel);
      const currentCommit = await this.repoIndexerService.resolveCurrentCommit(
        REPO_CLONE_DIR,
        execFn,
      );
      const chunkingSignatureHash =
        this.repoIndexerService.getChunkingSignatureHash();
      const repoSlug = this.repoIndexerService.deriveRepoSlug(
        entity.repositoryId,
      );
      const collection = this.repoIndexerService.buildCollectionName(
        repoSlug,
        vectorSize,
      );

      const needsFullReindex =
        !entity.lastIndexedCommit ||
        entity.embeddingModel !== embeddingModel ||
        entity.vectorSize !== vectorSize ||
        entity.chunkingSignatureHash !== chunkingSignatureHash;

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

      if (needsFullReindex) {
        await this.repoIndexerService.runFullIndex(indexParams, execFn);
      } else {
        await this.repoIndexerService.runIncrementalIndex(indexParams, execFn);
      }

      await this.repoIndexDao.updateById(repoIndexId, {
        status: RepoIndexStatus.Completed,
        lastIndexedCommit: currentCommit,
        embeddingModel,
        vectorSize,
        chunkingSignatureHash,
        qdrantCollection: collection,
        errorMessage: null,
      });

      this.logger.debug('Repo index job completed', {
        repoIndexId,
        currentCommit,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.repoIndexDao.updateById(repoIndexId, {
        status: RepoIndexStatus.Failed,
        errorMessage,
      });
      throw err; // rethrow for BullMQ retry
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
          .catch(() => undefined);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: helpers
  // ---------------------------------------------------------------------------

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
  }): Promise<RepoIndexEntity> {
    const payload = {
      status: params.status,
      qdrantCollection: params.qdrantCollection,
      embeddingModel: params.embeddingModel,
      vectorSize: params.vectorSize,
      chunkingSignatureHash: params.chunkingSignatureHash,
      estimatedTokens: params.estimatedTokens,
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

    const extension = match.path
      .split('.')
      .pop()
      ?.toLowerCase()
      .replace('.', '');

    return extension === normalized;
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
