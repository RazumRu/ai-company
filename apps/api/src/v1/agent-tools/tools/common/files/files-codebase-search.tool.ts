import { createHash } from 'node:crypto';
import { extname, join as joinPath } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';
import ignore from 'ignore';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import type { RequestTokenUsage } from '../../../../litellm/litellm.types';
import { LitellmService } from '../../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { OpenaiService } from '../../../../openai/openai.service';
import { QdrantService } from '../../../../qdrant/services/qdrant.service';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const DEFAULT_TOP_K = 10;
const MAX_TOP_K = 20;

const CodebaseSearchSchema = z.object({
  query: z.string().min(1).describe('Query to search for in the codebase.'),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .optional()
    .describe('Maximum number of results to return.'),
  directory: z
    .string()
    .min(1)
    .describe('Absolute path to the cloned repository directory.'),
  language: z
    .string()
    .min(1)
    .optional()
    .describe('Optional language filter (e.g. ts, py, go).'),
});

type CodebaseSearchSchemaType = z.infer<typeof CodebaseSearchSchema>;

type CodebaseSearchResult = {
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  score: number;
};

type CodebaseSearchResultInternal = CodebaseSearchResult;

type CodebaseSearchOutput = {
  error?: string;
  results?: CodebaseSearchResult[];
};

type CodebaseIndexState = {
  repo_id: string;
  last_indexed_commit: string;
  last_indexed_at: string;
  embedding_model: string;
  vector_size: number;
  chunking_signature_hash: string;
  chunking_signature?: Record<string, unknown>;
};

type ChunkDescriptor = {
  text: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
  chunkHash: string;
  tokenCount: number;
};

type ChunkBatchItem = {
  repoId: string;
  commit: string;
  filePath: string;
  fileHash: string;
  chunk: ChunkDescriptor;
};

type FileIndexInput = {
  relativePath: string;
  absolutePath: string;
  content: string;
  fileHash: string;
};

type QdrantPointPayload = {
  repo_id: string;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  chunk_hash: string;
  file_hash: string;
  commit: string;
  indexed_at: string;
};

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesCodebaseSearchTool extends FilesBaseTool<CodebaseSearchSchemaType> {
  public name = 'codebase_search';
  public description =
    'Semantic search across a git repo codebase using Qdrant.';

  private readonly ignoreCache = new Map<string, ReturnType<typeof ignore>>();

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly openaiService: OpenaiService,
    private readonly litellmService: LitellmService,
    private readonly llmModelsService: LlmModelsService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Semantic codebase search that indexes a git repository into Qdrant on demand.

      ### When to Use
      - FIRST STEP for any codebase discovery or "where is X?" question
      - Large repos where reading many files is slow
      - Locating relevant code chunks by description

      ### Requirements
      - Must be inside a git repository
      - \`directory\` is required (absolute path to the repo)
      - Indexing happens only when this tool is invoked

      ### Recommended Flow
      1) Run \`codebase_search\` with a semantic query.
      2) Read top results with \`files_read\`.
      3) Use \`files_search_text\` for exact usages or strings.

      ### Example
      \`\`\`json
      {"query":"where is auth middleware created?","top_k":5,"directory":"apps/api/src","language":"ts"}
      \`\`\`
    `;
  }

  public get schema() {
    return CodebaseSearchSchema;
  }

  protected override generateTitle(
    args: CodebaseSearchSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Codebase search: ${args.query}`;
  }

  public async invoke(
    args: CodebaseSearchSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<CodebaseSearchOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const normalizedQuery = args.query.trim();
    if (!normalizedQuery) {
      return {
        output: { error: 'query is required' },
        messageMetadata,
      };
    }

    const repoRoot = await this.resolveRepoRoot(config, cfg, args.directory);
    if (!repoRoot) {
      return {
        output: {
          error:
            'codebase_search requires a cloned git repository (no git work tree detected).',
        },
        messageMetadata,
      };
    }

    const repoInfo = await this.resolveRepoInfo(repoRoot, config, cfg);
    if ('error' in repoInfo) {
      return { output: { error: repoInfo.error }, messageMetadata };
    }

    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const usageCollector: { usage: RequestTokenUsage | null } = {
      usage: null,
    };
    const vectorSize = await this.getVectorSizeForModel(
      embeddingModel,
      usageCollector,
    );
    const collection = this.qdrantService.buildSizedCollectionName(
      this.buildCollectionBaseName(repoInfo.repoSlug),
      vectorSize,
    );

    const state = await this.getIndexState(collection, repoInfo.repoId);
    const shouldIndex = this.shouldIndexRepo(
      state,
      repoInfo.repoId,
      repoInfo.currentCommit,
      embeddingModel,
      vectorSize,
    );

    if (shouldIndex.mode === 'full') {
      await this.fullIndexRepo(
        collection,
        repoInfo,
        vectorSize,
        embeddingModel,
        usageCollector,
        config,
        cfg,
      );
    } else if (shouldIndex.mode === 'incremental') {
      await this.incrementalIndexRepo(
        collection,
        repoInfo,
        shouldIndex.lastIndexedCommit,
        vectorSize,
        embeddingModel,
        usageCollector,
        config,
        cfg,
      );
    }

    if (shouldIndex.mode !== 'none') {
      await this.writeIndexState(
        collection,
        repoInfo.repoId,
        repoInfo.currentCommit,
        embeddingModel,
        vectorSize,
      );
    }

    const queryEmbedding = await this.embedTextsWithUsage(
      [normalizedQuery],
      embeddingModel,
      usageCollector,
    );
    if (queryEmbedding.length === 0 || !queryEmbedding[0]) {
      return {
        output: { error: 'embedding failed for query' },
        messageMetadata,
      };
    }

    const searchLimit = this.buildSearchLimit(args.top_k);
    const matches = await this.qdrantService.searchPoints(
      collection,
      queryEmbedding[0],
      searchLimit,
      {
        filter: this.buildRepoFilter(repoInfo.repoId),
        with_payload: true,
      },
    );

    const filtered = matches
      .map((match) => this.parseSearchResult(match))
      .filter((match): match is CodebaseSearchResultInternal => Boolean(match))
      .filter((match) => this.matchesPathPrefix(match, args.directory))
      .filter((match) => this.matchesLanguage(match, args.language))
      .slice(0, args.top_k ?? DEFAULT_TOP_K)
      .map((match) => ({
        path: match.path,
        start_line: match.start_line,
        end_line: match.end_line,
        text: match.text,
        score: match.score,
      }));

    return {
      output: { results: filtered },
      messageMetadata,
      toolRequestUsage: usageCollector.usage ?? undefined,
    };
  }

  private buildCollectionBaseName(repoSlug: string): string {
    return `codebase_${repoSlug}`;
  }

  private buildSearchLimit(topK?: number): number {
    const limit = topK ?? DEFAULT_TOP_K;
    const expanded = Math.max(limit * 4, limit);
    return Math.min(expanded, MAX_TOP_K * 4);
  }

  private async resolveRepoRoot(
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    directory: string,
  ): Promise<string | null> {
    const trimmed = directory.trim();
    const absoluteDir = trimmed.startsWith(BASE_RUNTIME_WORKDIR)
      ? trimmed
      : joinPath(BASE_RUNTIME_WORKDIR, trimmed.replace(/^\/+/, ''));
    const res = await this.execCommand(
      { cmd: `git -C ${shQuote(absoluteDir)} rev-parse --show-toplevel` },
      config,
      cfg,
    );
    if (res.exitCode !== 0) {
      return null;
    }
    const root = res.stdout.trim();
    return root.length ? root : null;
  }

  private async resolveRepoInfo(
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<
    | {
        repoId: string;
        repoSlug: string;
        currentCommit: string;
        repoRoot: string;
      }
    | { error: string }
  > {
    const currentCommitRes = await this.execCommand(
      { cmd: `git -C ${shQuote(repoRoot)} rev-parse HEAD` },
      config,
      cfg,
    );
    if (currentCommitRes.exitCode !== 0) {
      return { error: currentCommitRes.stderr || 'Failed to read git commit' };
    }
    const currentCommit = currentCommitRes.stdout.trim();

    const remoteRes = await this.execCommand(
      { cmd: `git -C ${shQuote(repoRoot)} remote get-url origin` },
      config,
      cfg,
    );
    const remoteUrl = remoteRes.exitCode === 0 ? remoteRes.stdout.trim() : '';
    const repoId = remoteUrl
      ? this.normalizeRepoId(remoteUrl)
      : `local:${repoRoot}`;
    const repoSlug = this.slugifyRepoId(repoId);

    if (!currentCommit) {
      return { error: 'Failed to resolve git commit hash' };
    }

    return { repoId, repoSlug, currentCommit, repoRoot };
  }

  private normalizeRepoId(url: string): string {
    let normalized = url.trim();
    if (normalized.startsWith('git@') && normalized.includes(':')) {
      const [host, pathPart] = normalized.replace('git@', '').split(':');
      normalized = `https://${host}/${pathPart}`;
    }
    normalized = normalized.replace(/^ssh:\/\//, 'https://');
    normalized = normalized.replace(/\.git$/i, '');
    return normalized.replace(/\/+$/, '');
  }

  private slugifyRepoId(repoId: string): string {
    const base = repoId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const trimmed = base.replace(/^_+|_+$/g, '');
    if (trimmed.length <= 80) {
      return trimmed || 'repo';
    }
    const hash = this.sha1(repoId).slice(0, 8);
    return `${trimmed.slice(0, 60)}_${hash}`;
  }

  private async getVectorSizeForModel(
    model: string,
    usageCollector: { usage: RequestTokenUsage | null },
  ): Promise<number> {
    const embeddings = await this.embedTextsWithUsage(
      ['ping'],
      model,
      usageCollector,
    );
    return this.qdrantService.getVectorSizeFromEmbeddings(embeddings);
  }

  private async embedTextsWithUsage(
    texts: string[],
    model: string,
    usageCollector: { usage: RequestTokenUsage | null },
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const result = await this.openaiService.embeddings({
      model,
      input: texts,
    });
    this.addUsage(usageCollector, result.usage);
    return result.embeddings;
  }

  private buildEmbeddingBatches(
    texts: string[],
    tokenCounts: number[],
    maxTokens: number,
  ): { items: string[]; tokenCounts: number[] }[] {
    const batches: { items: string[]; tokenCounts: number[] }[] = [];
    let currentItems: string[] = [];
    let currentTokenCounts: number[] = [];
    let currentTokens = 0;

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      const tokens = tokenCounts[i] ?? 0;
      if (currentTokens + tokens > maxTokens && currentItems.length > 0) {
        batches.push({ items: currentItems, tokenCounts: currentTokenCounts });
        currentItems = [];
        currentTokenCounts = [];
        currentTokens = 0;
      }
      currentItems.push(text ?? '');
      currentTokenCounts.push(tokens);
      currentTokens += tokens;
    }

    if (currentItems.length > 0) {
      batches.push({ items: currentItems, tokenCounts: currentTokenCounts });
    }

    return batches;
  }

  private async embedTextsWithUsageConcurrent(
    texts: string[],
    tokenCounts: number[],
    model: string,
    usageCollector: { usage: RequestTokenUsage | null },
    maxTokens: number,
    concurrency = environment.codebaseEmbeddingConcurrency,
  ): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batches = this.buildEmbeddingBatches(texts, tokenCounts, maxTokens);
    const results: number[][] = [];

    for (let i = 0; i < batches.length; i += concurrency) {
      const slice = batches.slice(i, i + concurrency);
      const sliceResults = await Promise.all(
        slice.map(async (batch) => {
          const result = await this.openaiService.embeddings({
            model,
            input: batch.items,
          });
          this.addUsage(usageCollector, result.usage);
          return result.embeddings;
        }),
      );
      for (const embeddingSet of sliceResults) {
        results.push(...embeddingSet);
      }
    }

    return results;
  }

  private addUsage(
    usageCollector: { usage: RequestTokenUsage | null },
    usage: RequestTokenUsage | null | undefined,
  ) {
    usageCollector.usage = this.litellmService.sumTokenUsages([
      usageCollector.usage,
      usage,
    ]);
  }

  private shouldIndexRepo(
    state: CodebaseIndexState | null,
    repoId: string,
    currentCommit: string,
    embeddingModel: string,
    vectorSize: number,
  ): { mode: 'full' | 'incremental' | 'none'; lastIndexedCommit?: string } {
    if (!state) {
      return { mode: 'full' };
    }
    if (state.repo_id !== repoId) {
      return { mode: 'full' };
    }
    if (state.embedding_model !== embeddingModel) {
      return { mode: 'full' };
    }
    if (state.vector_size !== vectorSize) {
      return { mode: 'full' };
    }
    const signatureHash = this.getChunkingSignatureHash();
    if (state.chunking_signature_hash !== signatureHash) {
      return { mode: 'full' };
    }
    if (state.last_indexed_commit === currentCommit) {
      return { mode: 'none' };
    }
    return {
      mode: 'incremental',
      lastIndexedCommit: state.last_indexed_commit,
    };
  }

  private async getIndexState(
    collection: string,
    repoId: string,
  ): Promise<CodebaseIndexState | null> {
    const points = await this.qdrantService.retrievePoints(collection, {
      ids: [this.buildStatePointId(repoId)],
      with_payload: true,
    });
    const point = points[0];
    if (!point || !point.payload) {
      return null;
    }
    const payload = point.payload as Partial<CodebaseIndexState>;
    if (!payload.repo_id || !payload.last_indexed_commit) {
      return null;
    }
    if (
      !payload.embedding_model ||
      !payload.vector_size ||
      !payload.chunking_signature_hash
    ) {
      return null;
    }
    return {
      repo_id: String(payload.repo_id),
      last_indexed_commit: String(payload.last_indexed_commit),
      last_indexed_at: String(payload.last_indexed_at ?? ''),
      embedding_model: String(payload.embedding_model),
      vector_size: Number(payload.vector_size),
      chunking_signature_hash: String(payload.chunking_signature_hash),
      chunking_signature: payload.chunking_signature as
        | Record<string, unknown>
        | undefined,
    };
  }

  private async writeIndexState(
    collection: string,
    repoId: string,
    currentCommit: string,
    embeddingModel: string,
    vectorSize: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const vector = new Array(vectorSize).fill(0);
    await this.qdrantService.upsertPoints(collection, [
      {
        id: this.buildStatePointId(repoId),
        vector,
        payload: {
          repo_id: repoId,
          last_indexed_commit: currentCommit,
          last_indexed_at: now,
          embedding_model: embeddingModel,
          vector_size: vectorSize,
          chunking_signature_hash: this.getChunkingSignatureHash(),
          chunking_signature: this.buildChunkingSignature(),
        },
      },
    ]);
  }

  private async fullIndexRepo(
    collection: string,
    repoInfo: {
      repoId: string;
      repoRoot: string;
      currentCommit: string;
    },
    vectorSize: number,
    embeddingModel: string,
    usageCollector: { usage: RequestTokenUsage | null },
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<void> {
    const files = await this.listTrackedFiles(repoInfo.repoRoot, config, cfg);
    const filtered: string[] = [];
    for (const path of files) {
      const shouldIndex = await this.shouldIndexPath(
        path,
        repoInfo.repoRoot,
        config,
        cfg,
      );
      if (shouldIndex) {
        filtered.push(path);
      }
    }

    await this.qdrantService.deleteByFilter(
      collection,
      this.buildRepoFilter(repoInfo.repoId),
    );

    const totalFiles = filtered.length;
    const progressStep = Math.max(1, Math.floor(totalFiles / 10));
    let processedFiles = 0;
    let indexedFiles = 0;
    let skippedFiles = 0;

    this.logger.debug('Codebase index: starting full index', {
      repoId: repoInfo.repoId,
      repoRoot: repoInfo.repoRoot,
      totalFiles,
    });

    const batch: ChunkBatchItem[] = [];
    let batchTokenCount = 0;
    const maxTokens = environment.codebaseEmbeddingMaxTokens;
    for (const relativePath of filtered) {
      processedFiles += 1;
      const fileInput = await this.prepareFileIndexInput(
        repoInfo.repoRoot,
        relativePath,
        config,
        cfg,
      );
      if (!fileInput) {
        skippedFiles += 1;
        if (
          processedFiles % progressStep === 0 ||
          processedFiles === totalFiles
        ) {
          this.logger.debug('Codebase index progress', {
            processedFiles,
            totalFiles,
            indexedFiles,
            skippedFiles,
          });
        }
        continue;
      }
      const chunks = await this.chunkText(fileInput.content, embeddingModel);
      if (chunks.length === 0) {
        skippedFiles += 1;
      } else {
        indexedFiles += 1;
      }
      for (const chunk of chunks) {
        if (
          batchTokenCount + chunk.tokenCount > maxTokens &&
          batch.length > 0
        ) {
          await this.flushChunkBatch(
            collection,
            batch,
            vectorSize,
            embeddingModel,
            usageCollector,
            maxTokens,
          );
          batchTokenCount = 0;
        }
        batch.push({
          repoId: repoInfo.repoId,
          commit: repoInfo.currentCommit,
          filePath: fileInput.relativePath,
          fileHash: fileInput.fileHash,
          chunk,
        });
        batchTokenCount += chunk.tokenCount;
      }
      if (
        processedFiles % progressStep === 0 ||
        processedFiles === totalFiles
      ) {
        this.logger.debug('Codebase index progress', {
          processedFiles,
          totalFiles,
          indexedFiles,
          skippedFiles,
        });
      }
    }
    await this.flushChunkBatch(
      collection,
      batch,
      vectorSize,
      embeddingModel,
      usageCollector,
      maxTokens,
    );
  }

  private async incrementalIndexRepo(
    collection: string,
    repoInfo: {
      repoId: string;
      repoRoot: string;
      currentCommit: string;
      repoSlug: string;
    },
    lastIndexedCommit: string | undefined,
    vectorSize: number,
    embeddingModel: string,
    usageCollector: { usage: RequestTokenUsage | null },
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<void> {
    const diffPaths = lastIndexedCommit
      ? await this.listChangedFiles(
          repoInfo.repoRoot,
          lastIndexedCommit,
          repoInfo.currentCommit,
          config,
          cfg,
        )
      : null;

    if (!diffPaths) {
      await this.fullIndexRepo(
        collection,
        repoInfo,
        vectorSize,
        embeddingModel,
        usageCollector,
        config,
        cfg,
      );
      return;
    }

    const statusPaths = await this.listWorkingTreeChanges(
      repoInfo.repoRoot,
      config,
      cfg,
    );
    const allPaths = new Set([...diffPaths, ...statusPaths]);

    const totalFiles = allPaths.size;
    const progressStep = Math.max(1, Math.floor(totalFiles / 10));
    let processedFiles = 0;
    let indexedFiles = 0;
    let skippedFiles = 0;

    this.logger.debug('Codebase index: starting incremental index', {
      repoId: repoInfo.repoId,
      repoRoot: repoInfo.repoRoot,
      totalFiles,
    });

    const batch: ChunkBatchItem[] = [];
    let batchTokenCount = 0;
    const maxTokens = environment.codebaseEmbeddingMaxTokens;
    for (const relativePath of allPaths) {
      processedFiles += 1;
      const shouldIndex = await this.shouldIndexPath(
        relativePath,
        repoInfo.repoRoot,
        config,
        cfg,
      );

      await this.qdrantService.deleteByFilter(
        collection,
        this.buildFileFilter(repoInfo.repoId, relativePath),
      );

      if (!shouldIndex) {
        skippedFiles += 1;
        if (
          processedFiles % progressStep === 0 ||
          processedFiles === totalFiles
        ) {
          this.logger.debug('Codebase index progress', {
            processedFiles,
            totalFiles,
            indexedFiles,
            skippedFiles,
          });
        }
        continue;
      }

      const exists = await this.fileExists(
        repoInfo.repoRoot,
        relativePath,
        config,
        cfg,
      );
      if (!exists) {
        skippedFiles += 1;
        if (
          processedFiles % progressStep === 0 ||
          processedFiles === totalFiles
        ) {
          this.logger.debug('Codebase index progress', {
            processedFiles,
            totalFiles,
            indexedFiles,
            skippedFiles,
          });
        }
        continue;
      }

      const fileInput = await this.prepareFileIndexInput(
        repoInfo.repoRoot,
        relativePath,
        config,
        cfg,
      );
      if (!fileInput) {
        skippedFiles += 1;
        if (
          processedFiles % progressStep === 0 ||
          processedFiles === totalFiles
        ) {
          this.logger.debug('Codebase index progress', {
            processedFiles,
            totalFiles,
            indexedFiles,
            skippedFiles,
          });
        }
        continue;
      }

      const chunks = await this.chunkText(fileInput.content, embeddingModel);
      if (chunks.length === 0) {
        skippedFiles += 1;
      } else {
        indexedFiles += 1;
      }
      for (const chunk of chunks) {
        if (
          batchTokenCount + chunk.tokenCount > maxTokens &&
          batch.length > 0
        ) {
          await this.flushChunkBatch(
            collection,
            batch,
            vectorSize,
            embeddingModel,
            usageCollector,
            maxTokens,
          );
          batchTokenCount = 0;
        }
        batch.push({
          repoId: repoInfo.repoId,
          commit: repoInfo.currentCommit,
          filePath: fileInput.relativePath,
          fileHash: fileInput.fileHash,
          chunk,
        });
        batchTokenCount += chunk.tokenCount;
      }
      if (
        processedFiles % progressStep === 0 ||
        processedFiles === totalFiles
      ) {
        this.logger.debug('Codebase index progress', {
          processedFiles,
          totalFiles,
          indexedFiles,
          skippedFiles,
        });
      }
    }
    await this.flushChunkBatch(
      collection,
      batch,
      vectorSize,
      embeddingModel,
      usageCollector,
      maxTokens,
    );
  }

  private async listTrackedFiles(
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string[]> {
    const res = await this.execCommand(
      { cmd: `git -C ${shQuote(repoRoot)} ls-files` },
      config,
      cfg,
    );
    if (res.exitCode !== 0) {
      return [];
    }
    return res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async listChangedFiles(
    repoRoot: string,
    fromCommit: string,
    toCommit: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string[] | null> {
    const res = await this.execCommand(
      {
        cmd: `git -C ${shQuote(repoRoot)} diff --name-only ${shQuote(
          fromCommit,
        )}..${shQuote(toCommit)}`,
      },
      config,
      cfg,
    );
    if (res.exitCode !== 0) {
      return null;
    }
    return res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async listWorkingTreeChanges(
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string[]> {
    const res = await this.execCommand(
      { cmd: `git -C ${shQuote(repoRoot)} status --porcelain` },
      config,
      cfg,
    );
    if (res.exitCode !== 0) {
      return [];
    }
    const paths = new Set<string>();
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const payload = trimmed.slice(3).trim();
      if (!payload) continue;
      if (payload.includes('->')) {
        const [from, to] = payload.split('->').map((p) => p.trim());
        if (from) paths.add(from);
        if (to) paths.add(to);
      } else {
        paths.add(payload);
      }
    }
    return Array.from(paths);
  }

  private async shouldIndexPath(
    path: string,
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<boolean> {
    if (!path) return false;
    const normalized = this.normalizePath(path);
    const matcher = await this.loadIgnoreMatcher(repoRoot, config, cfg);
    if (matcher.ignores(normalized)) {
      return false;
    }
    return true;
  }

  private normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return normalized.replace(/^\.\//, '').replace(/^\/+/, '');
  }

  private async loadIgnoreMatcher(
    repoRoot: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ReturnType<typeof ignore>> {
    const cached = this.ignoreCache.get(repoRoot);
    if (cached) {
      return cached;
    }

    const matcher = ignore();
    const ignoreFilePath = joinPath(repoRoot, '.codebaseindexignore');
    const cmd = `if [ -f ${shQuote(
      ignoreFilePath,
    )} ]; then cat ${shQuote(ignoreFilePath)}; fi`;
    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode === 0 && res.stdout.trim()) {
      const lines = res.stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
      matcher.add(lines);
    }
    this.ignoreCache.set(repoRoot, matcher);
    return matcher;
  }

  private async fileExists(
    repoRoot: string,
    relativePath: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<boolean> {
    const abs = joinPath(repoRoot, relativePath);
    const res = await this.execCommand(
      { cmd: `test -f ${shQuote(abs)}` },
      config,
      cfg,
    );
    return res.exitCode === 0;
  }

  private async prepareFileIndexInput(
    repoRoot: string,
    relativePath: string,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FileIndexInput | null> {
    const absolutePath = joinPath(repoRoot, relativePath);
    const sizeRes = await this.execCommand(
      { cmd: `wc -c < ${shQuote(absolutePath)}` },
      config,
      cfg,
    );
    if (sizeRes.exitCode !== 0) {
      return null;
    }
    const size = Number.parseInt(sizeRes.stdout.trim(), 10);
    if (!Number.isFinite(size) || size > environment.codebaseMaxFileBytes) {
      return null;
    }

    const contentRes = await this.execCommand(
      { cmd: `cat ${shQuote(absolutePath)}` },
      config,
      cfg,
    );
    if (contentRes.exitCode !== 0) {
      return null;
    }

    const content = contentRes.stdout;
    if (!content.trim()) {
      return null;
    }
    if (content.includes('\u0000')) {
      return null;
    }

    const fileHash = this.sha1(content);
    return {
      relativePath,
      absolutePath,
      content,
      fileHash,
    };
  }

  private async flushChunkBatch(
    collection: string,
    batch: ChunkBatchItem[],
    vectorSize: number,
    embeddingModel: string,
    usageCollector: { usage: RequestTokenUsage | null },
    maxTokens: number,
  ): Promise<void> {
    if (batch.length === 0) {
      return;
    }
    const texts = batch.map((item) => item.chunk.text);
    const tokenCounts = batch.map((item) => item.chunk.tokenCount);
    const embeddings = await this.embedTextsWithUsageConcurrent(
      texts,
      tokenCounts,
      embeddingModel,
      usageCollector,
      maxTokens,
    );

    const actualVectorSize =
      this.qdrantService.getVectorSizeFromEmbeddings(embeddings);
    if (actualVectorSize !== vectorSize) {
      batch.length = 0;
      return;
    }
    const indexedAt = new Date().toISOString();
    const points = batch.map((item, index) => {
      const vector = embeddings[index];
      if (!vector) {
        return null;
      }
      const chunk = item.chunk;
      const id = this.buildPointId(item.repoId, item.filePath, chunk.chunkHash);
      const payload: QdrantPointPayload = {
        repo_id: item.repoId,
        path: item.filePath,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        text: chunk.text,
        chunk_hash: chunk.chunkHash,
        file_hash: item.fileHash,
        commit: item.commit,
        indexed_at: indexedAt,
      };
      return {
        id,
        vector,
        payload,
      };
    });
    const filteredPoints = points.filter(
      (point): point is NonNullable<typeof point> => Boolean(point),
    );
    await this.qdrantService.upsertPoints(collection, filteredPoints);
    batch.length = 0;
  }

  private async chunkText(
    content: string,
    embeddingModel: string,
  ): Promise<ChunkDescriptor[]> {
    if (!content) {
      return [];
    }
    const encoding = await this.litellmService.getTokenizer(embeddingModel);
    const tokens = encoding.encode(content);
    if (tokens.length === 0) {
      return [];
    }
    const lineStarts = this.buildLineStartOffsets(content);
    const targetTokens = Math.min(
      environment.codebaseChunkTargetTokens,
      environment.codebaseEmbeddingMaxTokens,
    );
    const overlapTokens = Math.min(
      environment.codebaseChunkOverlapTokens,
      Math.max(0, targetTokens - 1),
    );
    const tokenOffsets = Array.from({ length: tokens.length + 1 }, () => 0);
    for (let i = 0; i < tokens.length; i += 1) {
      const tokenValue = tokens[i] ?? 0;
      const tokenText = String(encoding.decode([tokenValue]));
      tokenOffsets[i + 1] = (tokenOffsets[i] ?? 0) + tokenText.length;
    }
    const chunks: ChunkDescriptor[] = [];
    let startToken = 0;
    let guard = 0;

    while (startToken < tokens.length && guard < 10_000) {
      guard += 1;
      const endToken = Math.min(startToken + targetTokens, tokens.length);
      if (endToken <= startToken) {
        break;
      }
      const startOffset = tokenOffsets[startToken] ?? 0;
      const endOffset = tokenOffsets[endToken] ?? startOffset;
      const text = content.slice(startOffset, endOffset);
      const startLine = this.lineForOffset(lineStarts, startOffset);
      const endLine = this.lineForOffset(
        lineStarts,
        Math.max(endOffset - 1, startOffset),
      );
      const chunkHash = this.sha1(text);
      const tokenCount = await this.litellmService.countTokens(
        embeddingModel,
        text,
      );
      chunks.push({
        text,
        startOffset,
        endOffset,
        startLine,
        endLine,
        chunkHash,
        tokenCount,
      });
      if (endToken >= tokens.length) {
        break;
      }
      startToken = Math.max(0, endToken - overlapTokens);
    }
    return chunks;
  }

  private buildLineStartOffsets(content: string): number[] {
    const offsets = [0];
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] === '\n') {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  private lineForOffset(offsets: number[], offset: number): number {
    let left = 0;
    let right = offsets.length - 1;
    let best = 0;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const value = offsets[mid];
      if (value === undefined) {
        break;
      }
      if (value <= offset) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return best + 1;
  }

  private buildRepoFilter(repoId: string) {
    return {
      must: [
        {
          key: 'repo_id',
          match: { value: repoId },
        },
      ],
    };
  }

  private buildFileFilter(repoId: string, path: string) {
    return {
      must: [
        {
          key: 'repo_id',
          match: { value: repoId },
        },
        {
          key: 'path',
          match: { value: path },
        },
      ],
    };
  }

  private parseSearchResult(
    match: Awaited<ReturnType<QdrantService['searchPoints']>>[number],
  ): CodebaseSearchResultInternal | null {
    const payload = (match.payload ?? {}) as Partial<QdrantPointPayload>;
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
    match: CodebaseSearchResult,
    directory?: string,
  ): boolean {
    if (!directory) {
      return true;
    }
    const normalized = directory.replace(/\\/g, '/').replace(/^\/+/, '');
    const withoutSlash = normalized.replace(/\/+$/, '');
    return (
      match.path === withoutSlash || match.path.startsWith(`${withoutSlash}/`)
    );
  }

  private matchesLanguage(
    match: CodebaseSearchResultInternal,
    language?: string,
  ): boolean {
    if (!language) {
      return true;
    }
    const normalized = language.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    const extension = extname(match.path).toLowerCase().replace('.', '');
    return extension === normalized;
  }

  private sha1(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }

  private buildChunkingSignature(): Record<string, unknown> {
    return {
      chunk_target_tokens: environment.codebaseChunkTargetTokens,
      chunk_overlap_tokens: environment.codebaseChunkOverlapTokens,
      embedding_max_tokens: environment.codebaseEmbeddingMaxTokens,
      break_strategy: 'token-window',
      line_counting: 'line-start-offsets',
      max_file_bytes: environment.codebaseMaxFileBytes,
      ignore_rules: {
        source: '.codebaseindexignore',
      },
      embedding_input: {
        format: 'raw',
      },
      point_id_scheme: {
        version: 'uuidv5',
        namespace: environment.codebaseUuidNamespace,
      },
    };
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const body = entries
      .map(
        ([key, val]) => `${JSON.stringify(key)}:${this.stableStringify(val)}`,
      )
      .join(',');
    return `{${body}}`;
  }

  private getChunkingSignatureHash(): string {
    const signature = this.buildChunkingSignature();
    return this.sha1(this.stableStringify(signature));
  }

  private buildPointId(
    repoId: string,
    filePath: string,
    chunkHash: string,
  ): string {
    return uuidv5(
      `${repoId}|${filePath}|${chunkHash}`,
      environment.codebaseUuidNamespace,
    );
  }

  private buildStatePointId(repoId: string): string {
    return uuidv5(`__state__|${repoId}`, environment.codebaseUuidNamespace);
  }
}
