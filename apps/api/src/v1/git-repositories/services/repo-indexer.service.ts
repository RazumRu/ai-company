import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import ignore from 'ignore';
import { v5 as uuidv5 } from 'uuid';

import { environment } from '../../../environments';
import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { shQuote } from '../../utils/shell.utils';
import { RepoIndexDao } from '../dao/repo-index.dao';

// Batch size for upserting points (copy, seed, etc.) to avoid overwhelming Qdrant
const POINT_COPY_BATCH_SIZE = 500;

// Page size for Qdrant scroll requests. scrollAll/scrollAllWithVectors
// paginate automatically, so this only controls memory per page.
const QDRANT_SCROLL_PAGE_SIZE = 1000;

// Number of files to flush per batch during full indexing
const FULL_INDEX_BATCH_FILE_COUNT = 15;

// Number of files to flush per batch during incremental indexing
const INCREMENTAL_BATCH_FILE_COUNT = 50;

// Number of files to read concurrently from the runtime container
const FILE_READ_CONCURRENCY = 10;

export type RepoExecFn = (params: {
  cmd: string;
}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

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
  token_count: number;
};

type PrefetchedChunkInfo = {
  fileHash: string;
  tokenCount: number;
  commit: string;
};

export interface RepoIndexParams {
  repoId: string;
  repoRoot: string;
  currentCommit: string;
  collection: string;
  vectorSize: number;
  embeddingModel: string;
  lastIndexedCommit?: string;
}

@Injectable()
export class RepoIndexerService {
  private static readonly IGNORE_CACHE_MAX_SIZE = 50;
  private readonly ignoreCache = new Map<string, ReturnType<typeof ignore>>();
  private readonly vectorSizePromiseCache = new Map<string, Promise<number>>();

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly openaiService: OpenaiService,
    private readonly litellmService: LitellmService,
    private readonly llmModelsService: LlmModelsService,
    private readonly repoIndexDao: RepoIndexDao,
    private readonly logger: DefaultLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Public: discovery helpers
  // ---------------------------------------------------------------------------

  async estimateTokenCount(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<number> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} ls-tree -r --long HEAD`,
    });
    if (res.exitCode !== 0) {
      return 0;
    }

    let totalBytes = 0;
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Format: <mode> <type> <hash> <size>\t<path>
      const tabIndex = trimmed.indexOf('\t');
      if (tabIndex === -1) continue;
      const meta = trimmed.slice(0, tabIndex).trim();
      const parts = meta.split(/\s+/);
      const size = Number.parseInt(parts[3] ?? '0', 10);
      if (Number.isFinite(size)) {
        totalBytes += size;
      }
    }

    return Math.floor(totalBytes / 4);
  }

  /**
   * Estimate token count for only the changed files between two commits,
   * including working tree changes that haven't been committed yet.
   * Used to decide if incremental indexing can run inline vs background.
   */
  async estimateChangedTokenCount(
    repoRoot: string,
    fromCommit: string,
    toCommit: string,
    execFn: RepoExecFn,
  ): Promise<number> {
    // Get list of changed files between commits
    const diffRes = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} diff --name-only ${shQuote(fromCommit)}..${shQuote(toCommit)}`,
    });
    if (diffRes.exitCode !== 0) {
      // If diff fails, fall back to full estimate
      return this.estimateTokenCount(repoRoot, execFn);
    }

    const diffFiles = diffRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Also include working tree changes that runIncrementalIndex will process
    const workingTreeFiles = await this.listWorkingTreeChanges(
      repoRoot,
      execFn,
    );
    const allChangedFiles = [...new Set([...diffFiles, ...workingTreeFiles])];

    if (allChangedFiles.length === 0) {
      return 0;
    }

    return this.estimateFileSizes(repoRoot, allChangedFiles, execFn);
  }

  /**
   * Estimate token count from a list of file paths by summing their sizes
   * from `git ls-tree` and dividing by 4.
   */
  private async estimateFileSizes(
    repoRoot: string,
    files: string[],
    execFn: RepoExecFn,
  ): Promise<number> {
    const BATCH_SIZE = 200;
    let totalBytes = 0;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const quotedPaths = batch.map((f) => shQuote(f)).join(' ');
      const sizeRes = await execFn({
        cmd: `git -C ${shQuote(repoRoot)} ls-tree -l HEAD -- ${quotedPaths}`,
      });
      if (sizeRes.exitCode === 0 && sizeRes.stdout.trim()) {
        for (const line of sizeRes.stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Format: <mode> <type> <hash> <size>\t<path>
          const tabIndex = trimmed.indexOf('\t');
          if (tabIndex === -1) continue;
          const meta = trimmed.slice(0, tabIndex).trim();
          const parts = meta.split(/\s+/);
          const size = Number.parseInt(parts[3] ?? '0', 10);
          if (Number.isFinite(size)) {
            totalBytes += size;
          }
        }
      }
    }

    return Math.floor(totalBytes / 4);
  }

  async resolveCurrentCommit(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<string> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} rev-parse HEAD`,
    });
    if (res.exitCode !== 0) {
      throw new Error(
        `Failed to resolve current commit: ${res.stderr || 'unknown error'}`,
      );
    }
    const commit = res.stdout.trim();
    if (!commit) {
      throw new Error('Failed to resolve current commit: empty result');
    }
    return commit;
  }

  async getCurrentBranch(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<string> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} rev-parse --abbrev-ref HEAD`,
    });
    return res.stdout.trim();
  }

  async getVectorSizeForModel(model: string): Promise<number> {
    const cached = this.vectorSizePromiseCache.get(model);
    if (cached) return cached;

    const promise = this.openaiService
      .embeddings({ model, input: ['ping'] })
      .then((result) =>
        this.qdrantService.getVectorSizeFromEmbeddings(result.embeddings),
      );
    this.vectorSizePromiseCache.set(model, promise);
    return promise;
  }

  // ---------------------------------------------------------------------------
  // Public: naming & signature helpers
  // ---------------------------------------------------------------------------

  deriveRepoId(url: string): string {
    let normalized = url.trim();
    if (normalized.startsWith('git@') && normalized.includes(':')) {
      const [host, pathPart] = normalized.replace('git@', '').split(':');
      normalized = `https://${host}/${pathPart}`;
    }
    normalized = normalized.replace(/^ssh:\/\//, 'https://');
    normalized = normalized.replace(/\.git$/i, '');
    return normalized.replace(/\/+$/, '');
  }

  deriveRepoSlug(repoId: string): string {
    const base = repoId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const trimmed = base.replace(/^_+|_+$/g, '');
    if (trimmed.length <= 80) {
      return trimmed || 'repo';
    }
    const hash = this.sha1(repoId).slice(0, 8);
    return `${trimmed.slice(0, 60)}_${hash}`;
  }

  deriveBranchSlug(branch: string): string {
    const sanitized = branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (sanitized.length <= 30) {
      return sanitized || 'default';
    }
    const hash = this.sha1(branch).slice(0, 8);
    return `${sanitized.slice(0, 20)}_${hash}`;
  }

  buildCollectionName(
    repoSlug: string,
    vectorSize: number,
    branchSlug?: string,
  ): string {
    const baseName = branchSlug
      ? `codebase_${repoSlug}_${branchSlug}`
      : `codebase_${repoSlug}`;
    return this.qdrantService.buildSizedCollectionName(baseName, vectorSize);
  }

  getChunkingSignatureHash(): string {
    return this.sha1(this.stableStringify(this.buildChunkingSignature()));
  }

  /**
   * Ensure Qdrant payload indexes exist on key fields for efficient filtering.
   * Called once per indexing run after the collection is created.
   */
  async ensureCodebasePayloadIndexes(collection: string): Promise<void> {
    await Promise.all([
      this.qdrantService.ensurePayloadIndex(collection, 'repo_id', 'keyword'),
      this.qdrantService.ensurePayloadIndex(collection, 'path', 'keyword'),
      this.qdrantService.ensurePayloadIndex(collection, 'file_hash', 'keyword'),
    ]);
  }

  /**
   * Calculates all metadata fields needed for repository indexing.
   * This centralizes the logic that was duplicated across multiple services.
   */
  async calculateIndexMetadata(
    repositoryId: string,
    branch: string,
  ): Promise<{
    embeddingModel: string;
    vectorSize: number;
    chunkingSignatureHash: string;
    repoSlug: string;
    collection: string;
  }> {
    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const vectorSize = await this.getVectorSizeForModel(embeddingModel);
    const chunkingSignatureHash = this.getChunkingSignatureHash();
    const repoSlug = this.deriveRepoSlug(repositoryId);
    const branchSlug = this.deriveBranchSlug(branch);
    const collection = this.buildCollectionName(
      repoSlug,
      vectorSize,
      branchSlug,
    );

    return {
      embeddingModel,
      vectorSize,
      chunkingSignatureHash,
      repoSlug,
      collection,
    };
  }

  // ---------------------------------------------------------------------------
  // Public: cross-branch seeding
  // ---------------------------------------------------------------------------

  /**
   * Copy all Qdrant points from one collection to another.
   * Used to seed a new branch's index from an existing branch.
   * The target collection is auto-created by `upsertPoints` if it does not exist.
   */
  async copyCollectionPoints(
    sourceCollection: string,
    targetCollection: string,
  ): Promise<number> {
    // Check existence via the raw client (collectionExists is private on the service)
    const collections = await this.qdrantService.raw.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === sourceCollection,
    );
    if (!exists) return 0;

    // Process pages one at a time instead of loading all points into memory.
    // Each scroll page is upserted to the target before fetching the next.
    let totalCopied = 0;
    let offset: string | number | Record<string, unknown> | undefined;

    while (true) {
      const page = await this.qdrantService.raw.scroll(sourceCollection, {
        limit: QDRANT_SCROLL_PAGE_SIZE,
        with_payload: true,
        with_vector: true,
        offset,
      });

      const points = page.points
        .filter((p) => p.id && p.vector && p.payload)
        .map((p) => ({
          id: p.id as string,
          vector: p.vector as number[],
          payload: p.payload as Record<string, unknown>,
        }));

      // Upsert current page in batches
      for (let i = 0; i < points.length; i += POINT_COPY_BATCH_SIZE) {
        const batch = points.slice(i, i + POINT_COPY_BATCH_SIZE);
        if (batch.length > 0) {
          await this.qdrantService.upsertPoints(targetCollection, batch);
        }
      }

      totalCopied += points.length;

      if (!page.next_page_offset) break;
      offset = page.next_page_offset;
    }

    return totalCopied;
  }

  // ---------------------------------------------------------------------------
  // Public: indexing entry points
  // ---------------------------------------------------------------------------

  async runFullIndex(
    params: RepoIndexParams,
    execFn: RepoExecFn,
    updateRuntimeActivity?: () => Promise<void>,
    onProgressUpdate?: (tokenCount: number) => Promise<void>,
  ): Promise<void> {
    const files = await this.listTrackedFiles(params.repoRoot, execFn);
    const matcher = await this.preloadIgnoreMatcher(params.repoRoot, execFn);
    const filtered: string[] = [];
    for (const path of files) {
      if (this.shouldIndexPathSync(path, matcher)) {
        filtered.push(path);
      }
    }

    // Ensure payload indexes exist for efficient filtering
    await this.ensureCodebasePayloadIndexes(params.collection);

    this.logger.debug('Codebase index: starting full index', {
      repoId: params.repoId,
      repoRoot: params.repoRoot,
      totalFiles: filtered.length,
    });

    // Pre-fetch existing chunk metadata from Qdrant to avoid per-file roundtrips
    const prefetchedChunks = await this.prefetchExistingChunks(
      params.collection,
      params.repoId,
    );

    const processedPaths = await this.processFiles(filtered, params, execFn, {
      batchFileCount: FULL_INDEX_BATCH_FILE_COUNT,
      updateRuntimeActivity,
      onProgressUpdate,
      prefetchedChunks,
      checkFileExists: false,
    });

    // Clean up orphaned chunks (files that no longer exist in the repo)
    await this.cleanupOrphanedChunks(
      params.collection,
      params.repoId,
      processedPaths,
    );
  }

  async runIncrementalIndex(
    params: RepoIndexParams,
    execFn: RepoExecFn,
    updateRuntimeActivity?: () => Promise<void>,
    onProgressUpdate?: (tokenCount: number) => Promise<void>,
  ): Promise<void> {
    const diffPaths = params.lastIndexedCommit
      ? await this.listChangedFiles(
          params.repoRoot,
          params.lastIndexedCommit,
          params.currentCommit,
          execFn,
        )
      : null;

    if (!diffPaths) {
      this.logger.warn(
        'Incremental diff failed (likely shallow clone missing commit), falling back to full reindex',
        {
          repoId: params.repoId,
          lastIndexedCommit: params.lastIndexedCommit,
          currentCommit: params.currentCommit,
        },
      );
      await this.runFullIndex(
        params,
        execFn,
        updateRuntimeActivity,
        onProgressUpdate,
      );
      return;
    }

    const statusPaths = await this.listWorkingTreeChanges(
      params.repoRoot,
      execFn,
    );
    const allPaths = [...new Set([...diffPaths, ...statusPaths])];

    // Ensure payload indexes exist for efficient filtering
    await this.ensureCodebasePayloadIndexes(params.collection);

    this.logger.debug('Codebase index: starting incremental index', {
      repoId: params.repoId,
      repoRoot: params.repoRoot,
      totalFiles: allPaths.length,
    });

    const matcher = await this.preloadIgnoreMatcher(params.repoRoot, execFn);

    // Filter by ignore rules and handle deletions first
    const filesToProcess: string[] = [];
    for (const relativePath of allPaths) {
      if (!this.shouldIndexPathSync(relativePath, matcher)) {
        continue;
      }

      if (!(await this.fileExists(params.repoRoot, relativePath, execFn))) {
        // File was deleted - remove old chunks
        await this.qdrantService.deleteByFilter(
          params.collection,
          this.buildFileFilter(params.repoId, relativePath),
        );
        continue;
      }

      filesToProcess.push(relativePath);
    }

    await this.processFiles(filesToProcess, params, execFn, {
      batchFileCount: INCREMENTAL_BATCH_FILE_COUNT,
      updateRuntimeActivity,
      onProgressUpdate,
      prefetchedChunks: null,
      checkFileExists: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: shared file processing loop
  // ---------------------------------------------------------------------------

  /**
   * Process a list of files: read, check for reuse, chunk, embed, and upsert.
   * Shared between runFullIndex and runIncrementalIndex to avoid duplication.
   * Returns the set of paths that were processed (for orphan cleanup).
   */
  private async processFiles(
    files: string[],
    params: RepoIndexParams,
    execFn: RepoExecFn,
    options: {
      batchFileCount: number;
      updateRuntimeActivity?: () => Promise<void>;
      onProgressUpdate?: (tokenCount: number) => Promise<void>;
      prefetchedChunks: Map<string, PrefetchedChunkInfo> | null;
      checkFileExists: boolean;
    },
  ): Promise<Set<string>> {
    const processedPaths = new Set<string>();
    const batch: ChunkBatchItem[] = [];
    let batchTokenCount = 0;
    const maxTokens = environment.codebaseEmbeddingMaxTokens;
    let filesInCurrentBatch = 0;

    // Read files in parallel batches to overlap I/O
    for (let i = 0; i < files.length; i += FILE_READ_CONCURRENCY) {
      const fileSlice = files.slice(i, i + FILE_READ_CONCURRENCY);
      const fileInputs = await Promise.all(
        fileSlice.map(async (relativePath) => {
          const input = await this.prepareFileIndexInput(
            params.repoRoot,
            relativePath,
            execFn,
          );
          return { relativePath, input };
        }),
      );

      for (const { relativePath, input: fileInput } of fileInputs) {
        processedPaths.add(relativePath);

        if (!fileInput) {
          continue;
        }

        // Check for content reuse: try prefetched map first, fall back to Qdrant
        const reuseResult = await this.checkFileReuse(
          params,
          fileInput,
          options.prefetchedChunks,
        );

        if (reuseResult.reused) {
          if (options.onProgressUpdate && reuseResult.tokenCount > 0) {
            try {
              await options.onProgressUpdate(reuseResult.tokenCount);
            } catch (err) {
              this.logger.error(
                err instanceof Error ? err : new Error(String(err)),
                'Failed to update progress for reused chunks',
                { tokenCount: reuseResult.tokenCount },
              );
            }
          }
          continue;
        }

        // Delete old chunks for this file before re-indexing with new content
        await this.qdrantService.deleteByFilter(
          params.collection,
          this.buildFileFilter(params.repoId, fileInput.relativePath),
        );

        // New content - chunk and embed
        const chunks = await this.chunkText(
          fileInput.content,
          params.embeddingModel,
        );

        for (const chunk of chunks) {
          if (
            batchTokenCount + chunk.tokenCount > maxTokens &&
            batch.length > 0
          ) {
            await this.flushChunkBatch(
              params.collection,
              batch,
              params.vectorSize,
              params.embeddingModel,
              maxTokens,
              options.onProgressUpdate,
            );
            batchTokenCount = 0;
            filesInCurrentBatch = 0;
          }
          batch.push({
            repoId: params.repoId,
            commit: params.currentCommit,
            filePath: fileInput.relativePath,
            fileHash: fileInput.fileHash,
            chunk,
          });
          batchTokenCount += chunk.tokenCount;
        }

        filesInCurrentBatch += 1;

        // Flush every N files to save progress
        if (filesInCurrentBatch >= options.batchFileCount && batch.length > 0) {
          await this.flushChunkBatch(
            params.collection,
            batch,
            params.vectorSize,
            params.embeddingModel,
            maxTokens,
            options.onProgressUpdate,
          );
          batchTokenCount = 0;
          filesInCurrentBatch = 0;

          if (options.updateRuntimeActivity) {
            await options.updateRuntimeActivity().catch(() => undefined);
          }
        }
      }
    }

    await this.flushChunkBatch(
      params.collection,
      batch,
      params.vectorSize,
      params.embeddingModel,
      maxTokens,
      options.onProgressUpdate,
    );

    return processedPaths;
  }

  /**
   * Check if a file's content can be reused from existing indexed chunks.
   * Uses the prefetched map for O(1) lookups when available, falls back to
   * the Qdrant-based checkAndCopyExistingChunks for metadata updates.
   */
  private async checkFileReuse(
    params: RepoIndexParams,
    fileInput: FileIndexInput,
    prefetchedChunks: Map<string, PrefetchedChunkInfo> | null,
  ): Promise<{ reused: boolean; tokenCount: number }> {
    if (prefetchedChunks) {
      const existing = prefetchedChunks.get(fileInput.relativePath);
      if (existing && existing.fileHash === fileInput.fileHash) {
        // Content matches — check if metadata needs updating
        if (existing.commit === params.currentCommit) {
          return { reused: true, tokenCount: existing.tokenCount };
        }
        // Same content but stale commit — need Qdrant call to update metadata
      } else if (!existing) {
        // Path not in Qdrant at all — new file, skip Qdrant check entirely
        return { reused: false, tokenCount: 0 };
      }
      // Different hash or stale commit — fall through to full Qdrant check
    }

    const { exists, tokenCount } = await this.checkAndCopyExistingChunks(
      params.collection,
      params.repoId,
      fileInput.fileHash,
      fileInput.relativePath,
      params.currentCommit,
      params.embeddingModel,
    );
    return { reused: exists, tokenCount };
  }

  /**
   * Pre-fetch all existing chunk metadata from Qdrant for a collection+repo.
   * Returns a map of path → { fileHash, tokenCount, commit } for O(1) lookups.
   * This replaces per-file Qdrant roundtrips during full indexing.
   */
  private async prefetchExistingChunks(
    collection: string,
    repoId: string,
  ): Promise<Map<string, PrefetchedChunkInfo>> {
    const map = new Map<string, PrefetchedChunkInfo>();
    try {
      let offset: string | number | Record<string, unknown> | undefined;

      while (true) {
        const page = await this.qdrantService.raw.scroll(collection, {
          filter: this.buildRepoFilter(repoId),
          limit: QDRANT_SCROLL_PAGE_SIZE,
          with_payload: {
            include: ['path', 'file_hash', 'token_count', 'commit'],
          },
          with_vector: false,
          offset,
        });

        for (const point of page.points) {
          const payload = point.payload as Partial<{
            path: string;
            file_hash: string;
            token_count: number;
            commit: string;
          }>;
          if (!payload.path || !payload.file_hash) continue;

          const existing = map.get(payload.path);
          const tokenCount = payload.token_count ?? 0;
          if (existing) {
            // Accumulate token counts across chunks of the same file
            existing.tokenCount += tokenCount;
          } else {
            map.set(payload.path, {
              fileHash: payload.file_hash,
              tokenCount,
              commit: payload.commit ?? '',
            });
          }
        }

        if (!page.next_page_offset) break;
        offset = page.next_page_offset;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !message.includes('not found') &&
        !message.includes('does not exist')
      ) {
        this.logger.warn('Failed to prefetch existing chunks', {
          collection,
          repoId,
          error: message,
        });
      }
      // Return empty map on failure — will fall back to per-file checks
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Private: git helpers
  // ---------------------------------------------------------------------------

  private async listTrackedFiles(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<string[]> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} ls-files`,
    });
    if (res.exitCode !== 0) return [];
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private async listChangedFiles(
    repoRoot: string,
    fromCommit: string,
    toCommit: string,
    execFn: RepoExecFn,
  ): Promise<string[] | null> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} diff --name-only ${shQuote(fromCommit)}..${shQuote(toCommit)}`,
    });
    if (res.exitCode !== 0) return null;
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  private async listWorkingTreeChanges(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<string[]> {
    const res = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} status --porcelain`,
    });
    if (res.exitCode !== 0) return [];

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

  // ---------------------------------------------------------------------------
  // Private: file filtering
  // ---------------------------------------------------------------------------

  /**
   * Pre-load the ignore matcher for a repo root. Call once at the start of
   * an indexing run and pass the result to `shouldIndexPathSync` to avoid
   * re-reading the ignore file for every single file.
   */
  async preloadIgnoreMatcher(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<ReturnType<typeof ignore>> {
    return this.loadIgnoreMatcher(repoRoot, execFn);
  }

  shouldIndexPathSync(
    path: string,
    matcher: ReturnType<typeof ignore>,
  ): boolean {
    if (!path) return false;
    const normalized = this.normalizePath(path);
    return !matcher.ignores(normalized);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  private async loadIgnoreMatcher(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<ReturnType<typeof ignore>> {
    // Read the ignore file content and use it as part of the cache key.
    // Different repos cloned to the same path (e.g. /workspace/repo in BullMQ
    // containers) will have different .codebaseindexignore content.
    const ignoreFilePath = `${repoRoot}/.codebaseindexignore`;
    const res = await execFn({
      cmd: `if [ -f ${shQuote(ignoreFilePath)} ]; then cat ${shQuote(ignoreFilePath)}; fi`,
    });
    const ignoreContent = res.exitCode === 0 ? res.stdout.trim() : '';

    // Cache key = repoRoot + hash of file content so stale rules are never served
    const cacheKey = `${repoRoot}:${this.sha1(ignoreContent)}`;
    const cached = this.ignoreCache.get(cacheKey);
    if (cached) return cached;

    const matcher = ignore();
    if (ignoreContent) {
      const lines = ignoreContent
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
      matcher.add(lines);
    }
    // Evict oldest entries when the cache exceeds the max size
    if (this.ignoreCache.size >= RepoIndexerService.IGNORE_CACHE_MAX_SIZE) {
      const oldest = this.ignoreCache.keys().next().value;
      if (oldest !== undefined) {
        this.ignoreCache.delete(oldest);
      }
    }
    this.ignoreCache.set(cacheKey, matcher);
    return matcher;
  }

  private async fileExists(
    repoRoot: string,
    relativePath: string,
    execFn: RepoExecFn,
  ): Promise<boolean> {
    const abs = `${repoRoot}/${relativePath}`;
    const res = await execFn({ cmd: `test -f ${shQuote(abs)}` });
    return res.exitCode === 0;
  }

  private async prepareFileIndexInput(
    repoRoot: string,
    relativePath: string,
    execFn: RepoExecFn,
  ): Promise<FileIndexInput | null> {
    const absolutePath = `${repoRoot}/${relativePath}`;
    const maxBytes = environment.codebaseMaxFileBytes;

    // Read up to maxBytes+1 in a single command — if output exceeds maxBytes
    // the file is too large. This avoids a separate `wc -c` roundtrip.
    const contentRes = await execFn({
      cmd: `head -c ${maxBytes + 1} ${shQuote(absolutePath)}`,
    });
    if (contentRes.exitCode !== 0) {
      this.logger.debug('Failed to read file content', {
        relativePath,
        stderr: contentRes.stderr,
      });
      return null;
    }

    const content = contentRes.stdout;

    // head -c reads bytes, but stdout is a string — use Buffer to check byte size
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      this.logger.debug('File too large to index', {
        relativePath,
        maxSize: maxBytes,
      });
      return null;
    }

    if (!content.trim()) {
      this.logger.debug('File is empty, skipping', { relativePath });
      return null;
    }
    if (content.includes('\u0000')) {
      this.logger.debug('File contains binary content, skipping', {
        relativePath,
      });
      return null;
    }

    return {
      relativePath,
      content,
      fileHash: this.sha1(content),
    };
  }

  // ---------------------------------------------------------------------------
  // Private: chunking
  // ---------------------------------------------------------------------------

  private async chunkText(
    content: string,
    embeddingModel: string,
  ): Promise<ChunkDescriptor[]> {
    if (!content) return [];

    const encoding = await this.litellmService.getTokenizer(embeddingModel);
    const tokens = encoding.encode(content);
    if (tokens.length === 0) return [];

    const lineStarts = this.buildLineStartOffsets(content);
    const targetTokens = Math.min(
      environment.codebaseChunkTargetTokens,
      environment.codebaseEmbeddingMaxTokens,
    );
    const overlapTokens = Math.min(
      environment.codebaseChunkOverlapTokens,
      Math.max(0, targetTokens - 1),
    );

    // Compute character offsets lazily — only at chunk boundaries — by
    // decoding the token prefix up to each boundary.  This replaces the old
    // per-token decode loop (N calls) with ~2 calls per chunk.
    const offsetCache = new Map<number, number>();
    offsetCache.set(0, 0);
    offsetCache.set(tokens.length, content.length);
    const charOffset = (tokenIdx: number): number => {
      const cached = offsetCache.get(tokenIdx);
      if (cached !== undefined) return cached;
      const prefix = tokens.slice(0, tokenIdx);
      const len = String(encoding.decode(prefix)).length;
      offsetCache.set(tokenIdx, len);
      return len;
    };

    const chunks: ChunkDescriptor[] = [];
    let startToken = 0;
    let guard = 0;

    while (startToken < tokens.length && guard < 10_000) {
      guard += 1;
      const endToken = Math.min(startToken + targetTokens, tokens.length);
      if (endToken <= startToken) break;

      const startOffset = charOffset(startToken);
      const endOffset = charOffset(endToken);
      const text = content.slice(startOffset, endOffset);
      const startLine = this.lineForOffset(lineStarts, startOffset);
      const endLine = this.lineForOffset(
        lineStarts,
        Math.max(endOffset - 1, startOffset),
      );
      const chunkHash = this.sha1(text);
      // Token count is already known from the token-window slicing — no need
      // to re-tokenize the text.
      const tokenCount = endToken - startToken;

      chunks.push({
        text,
        startOffset,
        endOffset,
        startLine,
        endLine,
        chunkHash,
        tokenCount,
      });

      if (endToken >= tokens.length) break;
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
      if (value === undefined) break;
      if (value <= offset) {
        best = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    return best + 1;
  }

  // ---------------------------------------------------------------------------
  // Private: embedding & upsert
  // ---------------------------------------------------------------------------

  private async flushChunkBatch(
    collection: string,
    batch: ChunkBatchItem[],
    vectorSize: number,
    embeddingModel: string,
    maxTokens: number,
    onProgressUpdate?: (tokenCount: number) => Promise<void>,
  ): Promise<void> {
    if (batch.length === 0) return;

    const texts = batch.map((item) => item.chunk.text);
    const tokenCounts = batch.map((item) => item.chunk.tokenCount);
    const embeddings = await this.embedTextsWithUsageConcurrent(
      texts,
      tokenCounts,
      embeddingModel,
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
      if (!vector) return null;

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
        token_count: chunk.tokenCount,
      };
      return { id, vector, payload };
    });

    const filteredPoints = points.filter(
      (point): point is NonNullable<typeof point> => Boolean(point),
    );

    await this.qdrantService.upsertPoints(collection, filteredPoints);

    // Calculate total tokens indexed in this batch
    const batchTokenCount = tokenCounts.reduce((sum, count) => sum + count, 0);

    this.logger.debug('Chunk batch saved to Qdrant', {
      collection,
      pointCount: filteredPoints.length,
      tokenCount: batchTokenCount,
    });

    // Update progress
    if (onProgressUpdate) {
      try {
        await onProgressUpdate(batchTokenCount);
      } catch (err) {
        this.logger.error(
          err instanceof Error ? err : new Error(String(err)),
          'Failed to update indexing progress',
          { tokenCount: batchTokenCount },
        );
      }
    }

    batch.length = 0;
  }

  private async embedTextsWithUsageConcurrent(
    texts: string[],
    tokenCounts: number[],
    model: string,
    maxTokens: number,
    concurrency = environment.codebaseEmbeddingConcurrency,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

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
          return result.embeddings;
        }),
      );
      for (const embeddingSet of sliceResults) {
        results.push(...embeddingSet);
      }
    }

    return results;
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

  // ---------------------------------------------------------------------------
  // Qdrant filters & point IDs
  // ---------------------------------------------------------------------------

  buildRepoFilter(repoId: string) {
    return {
      must: [{ key: 'repo_id', match: { value: repoId } }],
    };
  }

  private buildFileFilter(repoId: string, path: string) {
    return {
      must: [
        { key: 'repo_id', match: { value: repoId } },
        { key: 'path', match: { value: path } },
      ],
    };
  }

  private buildFileHashPathFilter(
    repoId: string,
    fileHash: string,
    path: string,
  ) {
    return {
      must: [
        { key: 'repo_id', match: { value: repoId } },
        { key: 'file_hash', match: { value: fileHash } },
        { key: 'path', match: { value: path } },
      ],
    };
  }

  /**
   * Clean up orphaned chunks (files that no longer exist in the repo).
   * This is called after full index to remove chunks for deleted files.
   * Uses paginated scroll to avoid loading all points into memory at once,
   * then batches all orphaned paths into a single delete operation.
   */
  private async cleanupOrphanedChunks(
    collection: string,
    repoId: string,
    validPaths: Set<string>,
  ): Promise<void> {
    try {
      const orphanedPaths = new Set<string>();
      let offset: string | number | Record<string, unknown> | undefined;

      // Paginate through all points, collecting orphaned paths
      while (true) {
        const page = await this.qdrantService.raw.scroll(collection, {
          filter: this.buildRepoFilter(repoId),
          limit: QDRANT_SCROLL_PAGE_SIZE,
          with_payload: { include: ['path'] },
          with_vector: false,
          offset,
        });

        for (const point of page.points) {
          const payload = point.payload as { path?: string } | undefined;
          const path = payload?.path;
          if (path && !validPaths.has(path)) {
            orphanedPaths.add(path);
          }
        }

        if (!page.next_page_offset) break;
        offset = page.next_page_offset;
      }

      if (orphanedPaths.size === 0) return;

      // Batch delete all orphaned paths in a single Qdrant call using
      // a `should` (OR) filter instead of one call per path.
      const orphanedArray = Array.from(orphanedPaths);

      for (let i = 0; i < orphanedArray.length; i += POINT_COPY_BATCH_SIZE) {
        const batch = orphanedArray.slice(i, i + POINT_COPY_BATCH_SIZE);
        await this.qdrantService.deleteByFilter(collection, {
          must: [{ key: 'repo_id', match: { value: repoId } }],
          should: batch.map((path) => ({
            key: 'path',
            match: { value: path },
          })),
        });
      }

      this.logger.debug('Cleaned up orphaned chunks', {
        collection,
        repoId,
        orphanedPathCount: orphanedPaths.size,
      });
    } catch (error) {
      // Log but don't fail if cleanup fails
      this.logger.warn('Failed to clean up orphaned chunks', {
        collection,
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if chunks for this file_hash already exist at the same path in the
   * collection. If found and both path and commit match, no work is needed.
   * If found but the commit differs, update commit metadata without re-embedding.
   * Returns { exists: boolean, tokenCount: number }
   */
  private async checkAndCopyExistingChunks(
    collection: string,
    repoId: string,
    fileHash: string,
    newPath: string,
    currentCommit: string,
    embeddingModel: string,
  ): Promise<{ exists: boolean; tokenCount: number }> {
    try {
      const filter = this.buildFileHashPathFilter(repoId, fileHash, newPath);

      // First check existence WITHOUT vectors — much cheaper than fetching vectors
      const lightPoints = await this.qdrantService.scrollAll(collection, {
        filter,
        limit: QDRANT_SCROLL_PAGE_SIZE,
        with_payload: true,
      } as Parameters<QdrantService['scrollAll']>[1]);

      if (lightPoints.length === 0) {
        return { exists: false, tokenCount: 0 };
      }

      // Calculate total tokens and check if any point needs updating
      let totalTokens = 0;
      let needsUpdate = false;

      for (const point of lightPoints) {
        const payload = point.payload as QdrantPointPayload;
        const chunkTokenCount =
          payload.token_count ??
          (await this.litellmService.countTokens(embeddingModel, payload.text));
        totalTokens += chunkTokenCount;

        if (payload.commit !== currentCommit || !payload.token_count) {
          needsUpdate = true;
        }
      }

      // If nothing needs updating, skip the expensive vector fetch
      if (!needsUpdate) {
        return { exists: true, tokenCount: totalTokens };
      }

      // Only fetch vectors for points that need metadata updates
      const allPoints = await this.qdrantService.scrollAllWithVectors(
        collection,
        {
          filter,
          limit: QDRANT_SCROLL_PAGE_SIZE,
          with_payload: true,
          with_vector: true,
        } as Parameters<QdrantService['scrollAllWithVectors']>[1],
      );

      const pointsToUpdate: {
        id: string;
        vector: number[];
        payload: Record<string, unknown>;
      }[] = [];

      for (const point of allPoints) {
        const payload = point.payload as QdrantPointPayload;
        if (payload.commit === currentCommit && payload.token_count) {
          continue;
        }

        const chunkTokenCount =
          payload.token_count ??
          (await this.litellmService.countTokens(embeddingModel, payload.text));
        const newId = this.buildPointId(repoId, newPath, payload.chunk_hash);
        pointsToUpdate.push({
          id: newId,
          vector: point.vector as number[],
          payload: {
            ...payload,
            commit: currentCommit,
            indexed_at: new Date().toISOString(),
            token_count: chunkTokenCount,
          },
        });
      }

      if (pointsToUpdate.length > 0) {
        for (let i = 0; i < pointsToUpdate.length; i += POINT_COPY_BATCH_SIZE) {
          const batch = pointsToUpdate.slice(i, i + POINT_COPY_BATCH_SIZE);
          await this.qdrantService.upsertPoints(collection, batch);
        }
      }

      return { exists: true, tokenCount: totalTokens };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('not found') ||
        errorMessage.includes('does not exist')
      ) {
        this.logger.debug('Collection or points not found during chunk copy', {
          repoId,
          fileHash,
          collection,
        });
        return { exists: false, tokenCount: 0 };
      }
      throw error;
    }
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

  // ---------------------------------------------------------------------------
  // Private: chunking signature
  // ---------------------------------------------------------------------------

  private buildChunkingSignature(): Record<string, unknown> {
    return {
      chunk_target_tokens: environment.codebaseChunkTargetTokens,
      chunk_overlap_tokens: environment.codebaseChunkOverlapTokens,
      embedding_max_tokens: environment.codebaseEmbeddingMaxTokens,
      break_strategy: 'token-window',
      line_counting: 'line-start-offsets',
      max_file_bytes: environment.codebaseMaxFileBytes,
      ignore_rules: { source: '.codebaseindexignore' },
      embedding_input: { format: 'raw' },
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

  // ---------------------------------------------------------------------------
  // Private: utility
  // ---------------------------------------------------------------------------

  private sha1(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }
}
