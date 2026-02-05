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
import { RepoIndexDao } from '../dao/repo-index.dao';

// Batch size for upserting copied chunks to avoid overwhelming Qdrant
const CHUNK_COPY_BATCH_SIZE = 1000;

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

export interface RepoIndexParams {
  repoId: string;
  repoRoot: string;
  currentCommit: string;
  collection: string;
  vectorSize: number;
  embeddingModel: string;
  lastIndexedCommit?: string;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class RepoIndexerService {
  private readonly ignoreCache = new Map<string, ReturnType<typeof ignore>>();

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
   * Estimate token count for only the changed files between two commits.
   * Used to decide if incremental indexing can run inline vs background.
   */
  async estimateChangedTokenCount(
    repoRoot: string,
    fromCommit: string,
    toCommit: string,
    execFn: RepoExecFn,
  ): Promise<number> {
    // Get list of changed files
    const diffRes = await execFn({
      cmd: `git -C ${shQuote(repoRoot)} diff --name-only ${shQuote(fromCommit)}..${shQuote(toCommit)}`,
    });
    if (diffRes.exitCode !== 0) {
      // If diff fails, fall back to full estimate
      return this.estimateTokenCount(repoRoot, execFn);
    }

    const changedFiles = diffRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (changedFiles.length === 0) {
      return 0;
    }

    // Get sizes of changed files
    let totalBytes = 0;
    for (const file of changedFiles) {
      const sizeRes = await execFn({
        cmd: `git -C ${shQuote(repoRoot)} ls-tree -l HEAD -- ${shQuote(file)}`,
      });
      if (sizeRes.exitCode === 0 && sizeRes.stdout.trim()) {
        // Format: <mode> <type> <hash> <size>\t<path>
        const line = sizeRes.stdout.trim();
        const tabIndex = line.indexOf('\t');
        if (tabIndex !== -1) {
          const meta = line.slice(0, tabIndex).trim();
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
    const result = await this.openaiService.embeddings({
      model,
      input: ['ping'],
    });
    return this.qdrantService.getVectorSizeFromEmbeddings(result.embeddings);
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

  buildCollectionName(repoSlug: string, vectorSize: number): string {
    const baseName = `codebase_${repoSlug}`;
    return this.qdrantService.buildSizedCollectionName(baseName, vectorSize);
  }

  getChunkingSignatureHash(): string {
    return this.sha1(this.stableStringify(this.buildChunkingSignature()));
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
    const filtered: string[] = [];
    for (const path of files) {
      if (await this.shouldIndexPath(path, params.repoRoot, execFn)) {
        filtered.push(path);
      }
    }

    // Track paths we've processed so we can clean up orphaned chunks at the end
    const processedPaths = new Set<string>();

    this.logger.debug('Codebase index: starting full index', {
      repoId: params.repoId,
      repoRoot: params.repoRoot,
      totalFiles: filtered.length,
    });

    const batch: ChunkBatchItem[] = [];
    let batchTokenCount = 0;
    const maxTokens = environment.codebaseEmbeddingMaxTokens;
    const BATCH_FILE_COUNT = 15; // Flush every N files to save progress
    let filesInCurrentBatch = 0;

    for (const relativePath of filtered) {
      processedPaths.add(relativePath);

      const fileInput = await this.prepareFileIndexInput(
        params.repoRoot,
        relativePath,
        execFn,
      );
      if (!fileInput) {
        continue;
      }

      // Check if chunks for this file_hash already exist (before deleting old path chunks)
      const { exists: chunksExist, tokenCount: reusedTokens } =
        await this.checkAndCopyExistingChunks(
          params.collection,
          params.repoId,
          fileInput.fileHash,
          fileInput.relativePath,
          params.currentCommit,
          params.embeddingModel,
        );

      if (chunksExist) {
        // Content unchanged - reused existing chunks (they were copied with updated path/commit)
        // Update progress for reused chunks
        if (onProgressUpdate && reusedTokens > 0) {
          try {
            await onProgressUpdate(reusedTokens);
          } catch (err) {
            this.logger.error(
              err instanceof Error ? err : new Error(String(err)),
              'Failed to update progress for reused chunks',
              { tokenCount: reusedTokens },
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
            onProgressUpdate,
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

      // Flush every BATCH_FILE_COUNT files to save progress
      if (filesInCurrentBatch >= BATCH_FILE_COUNT && batch.length > 0) {
        await this.flushChunkBatch(
          params.collection,
          batch,
          params.vectorSize,
          params.embeddingModel,
          maxTokens,
          onProgressUpdate,
        );
        batchTokenCount = 0;
        filesInCurrentBatch = 0;

        // Update runtime activity to prevent cleanup during indexing
        if (updateRuntimeActivity) {
          await updateRuntimeActivity().catch(() => undefined);
        }
      }
    }

    await this.flushChunkBatch(
      params.collection,
      batch,
      params.vectorSize,
      params.embeddingModel,
      maxTokens,
      onProgressUpdate,
    );

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
    const allPaths = new Set([...diffPaths, ...statusPaths]);

    this.logger.debug('Codebase index: starting incremental index', {
      repoId: params.repoId,
      repoRoot: params.repoRoot,
      totalFiles: allPaths.size,
    });

    const batch: ChunkBatchItem[] = [];
    let batchTokenCount = 0;
    const maxTokens = environment.codebaseEmbeddingMaxTokens;
    const BATCH_FILE_COUNT = 50; // Flush every N files to save progress
    let filesInCurrentBatch = 0;

    for (const relativePath of allPaths) {
      // Check if file should be indexed before deleting
      if (
        !(await this.shouldIndexPath(relativePath, params.repoRoot, execFn))
      ) {
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

      // Delete old chunks before re-indexing the file
      await this.qdrantService.deleteByFilter(
        params.collection,
        this.buildFileFilter(params.repoId, relativePath),
      );

      const fileInput = await this.prepareFileIndexInput(
        params.repoRoot,
        relativePath,
        execFn,
      );
      if (!fileInput) {
        continue;
      }

      // Check if chunks for this file_hash already exist
      const { exists: chunksExist, tokenCount: reusedTokens } =
        await this.checkAndCopyExistingChunks(
          params.collection,
          params.repoId,
          fileInput.fileHash,
          fileInput.relativePath,
          params.currentCommit,
          params.embeddingModel,
        );

      if (chunksExist) {
        // Content unchanged - reused existing chunks
        // Update progress for reused chunks
        if (onProgressUpdate && reusedTokens > 0) {
          try {
            await onProgressUpdate(reusedTokens);
          } catch (err) {
            this.logger.error(
              err instanceof Error ? err : new Error(String(err)),
              'Failed to update progress for reused chunks',
              { tokenCount: reusedTokens },
            );
          }
        }

        continue;
      }

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
            onProgressUpdate,
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

      // Flush every BATCH_FILE_COUNT files to save progress
      if (filesInCurrentBatch >= BATCH_FILE_COUNT && batch.length > 0) {
        await this.flushChunkBatch(
          params.collection,
          batch,
          params.vectorSize,
          params.embeddingModel,
          maxTokens,
          onProgressUpdate,
        );
        batchTokenCount = 0;
        filesInCurrentBatch = 0;

        // Update runtime activity to prevent cleanup during indexing
        if (updateRuntimeActivity) {
          await updateRuntimeActivity().catch(() => undefined);
        }
      }
    }

    await this.flushChunkBatch(
      params.collection,
      batch,
      params.vectorSize,
      params.embeddingModel,
      maxTokens,
      onProgressUpdate,
    );
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

  private async shouldIndexPath(
    path: string,
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<boolean> {
    if (!path) return false;
    const normalized = this.normalizePath(path);
    const matcher = await this.loadIgnoreMatcher(repoRoot, execFn);
    return !matcher.ignores(normalized);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  private async loadIgnoreMatcher(
    repoRoot: string,
    execFn: RepoExecFn,
  ): Promise<ReturnType<typeof ignore>> {
    const cached = this.ignoreCache.get(repoRoot);
    if (cached) return cached;

    const matcher = ignore();
    const ignoreFilePath = `${repoRoot}/.codebaseindexignore`;
    const res = await execFn({
      cmd: `if [ -f ${shQuote(ignoreFilePath)} ]; then cat ${shQuote(ignoreFilePath)}; fi`,
    });
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

    const sizeRes = await execFn({
      cmd: `wc -c < ${shQuote(absolutePath)}`,
    });
    if (sizeRes.exitCode !== 0) {
      this.logger.debug('Failed to get file size', {
        relativePath,
        stderr: sizeRes.stderr,
      });
      return null;
    }

    const size = Number.parseInt(sizeRes.stdout.trim(), 10);
    if (!Number.isFinite(size) || size > environment.codebaseMaxFileBytes) {
      this.logger.debug('File too large to index', {
        relativePath,
        size,
        maxSize: environment.codebaseMaxFileBytes,
      });
      return null;
    }

    const contentRes = await execFn({ cmd: `cat ${shQuote(absolutePath)}` });
    if (contentRes.exitCode !== 0) {
      this.logger.debug('Failed to read file content', {
        relativePath,
        stderr: contentRes.stderr,
      });
      return null;
    }

    const content = contentRes.stdout;
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
      if (endToken <= startToken) break;

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
  // Private: Qdrant filters & point IDs
  // ---------------------------------------------------------------------------

  private buildRepoFilter(repoId: string) {
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

  private buildFileHashFilter(repoId: string, fileHash: string) {
    return {
      must: [
        { key: 'repo_id', match: { value: repoId } },
        { key: 'file_hash', match: { value: fileHash } },
      ],
    };
  }

  /**
   * Clean up orphaned chunks (files that no longer exist in the repo).
   * This is called after full index to remove chunks for deleted files.
   */
  private async cleanupOrphanedChunks(
    collection: string,
    repoId: string,
    validPaths: Set<string>,
  ): Promise<void> {
    try {
      // Get all unique paths currently stored in Qdrant for this repo
      const allPoints = await this.qdrantService.scrollAll(collection, {
        filter: this.buildRepoFilter(repoId),
        limit: 100000,
        with_payload: true,
      } as Parameters<QdrantService['scrollAll']>[1]);

      // Find paths that exist in Qdrant but not in the current repo
      const orphanedPaths = new Set<string>();
      for (const point of allPoints) {
        const payload = point.payload as { path?: string } | undefined;
        const path = payload?.path;
        if (path && !validPaths.has(path)) {
          orphanedPaths.add(path);
        }
      }

      // Delete orphaned chunks
      for (const path of orphanedPaths) {
        await this.qdrantService.deleteByFilter(
          collection,
          this.buildFileFilter(repoId, path),
        );
        this.logger.debug('Deleted orphaned chunks for removed file', {
          collection,
          repoId,
          path,
        });
      }

      if (orphanedPaths.size > 0) {
        this.logger.debug('Cleaned up orphaned chunks', {
          collection,
          repoId,
          orphanedPathCount: orphanedPaths.size,
        });
      }
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
   * Check if chunks for this file_hash already exist in collection.
   * If so, copy them to new path with updated metadata instead of re-embedding.
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
      // Check if any chunks exist for this file_hash
      // Use large limit to handle files with many chunks (100k should cover even very large files)
      const allPoints = await this.qdrantService.scrollAllWithVectors(
        collection,
        {
          filter: this.buildFileHashFilter(repoId, fileHash),
          limit: 100000,
          with_payload: true,
          with_vector: true, // Need vectors to copy them to new points
        },
      );

      if (allPoints.length === 0) {
        return { exists: false, tokenCount: 0 };
      }

      // File content exists - copy all chunks with updated path and commit
      // Use stored token_count if available, otherwise compute (backwards compatibility)
      const copiedPointsWithTokens = await Promise.all(
        allPoints.map(async (point) => {
          const payload = point.payload as QdrantPointPayload;

          // Use stored token_count if available, fall back to computing for old data
          const chunkTokenCount =
            payload.token_count ??
            (await this.litellmService.countTokens(
              embeddingModel,
              payload.text,
            ));

          // Generate new point ID based on new path
          const newId = this.buildPointId(repoId, newPath, payload.chunk_hash);
          return {
            point: {
              id: newId,
              vector: point.vector as number[],
              payload: {
                ...payload,
                path: newPath,
                commit: currentCommit,
                indexed_at: new Date().toISOString(),
                token_count: chunkTokenCount, // Ensure token_count is set
              },
            },
            tokenCount: chunkTokenCount,
          };
        }),
      );

      const copiedPoints = copiedPointsWithTokens.map((p) => p.point);
      const totalTokens = copiedPointsWithTokens.reduce(
        (sum, p) => sum + p.tokenCount,
        0,
      );

      if (copiedPoints.length > 0) {
        // Batch upserts to avoid overwhelming Qdrant with large point sets
        for (let i = 0; i < copiedPoints.length; i += CHUNK_COPY_BATCH_SIZE) {
          const batch = copiedPoints.slice(i, i + CHUNK_COPY_BATCH_SIZE);
          await this.qdrantService.upsertPoints(collection, batch);
        }
      }

      return { exists: true, tokenCount: totalTokens };
    } catch (error) {
      // Only catch and return false for expected errors (collection not found, etc.)
      // Let unexpected errors propagate to surface infrastructure issues
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
      // Propagate unexpected errors
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
  // Public: total token count from Qdrant
  // ---------------------------------------------------------------------------

  /**
   * Calculate total tokens stored in Qdrant for this repo.
   * Uses token_count stored in payload for efficiency.
   * Falls back to counting tokens for old data without token_count.
   */
  async getTotalIndexedTokens(
    collection: string,
    repoId: string,
    embeddingModel: string,
  ): Promise<number> {
    try {
      const allPoints = await this.qdrantService.scrollAll(collection, {
        filter: this.buildRepoFilter(repoId),
        limit: 100000,
        with_payload: true,
      } as Parameters<QdrantService['scrollAll']>[1]);

      let totalTokens = 0;
      const pointsNeedingCount: { text: string }[] = [];

      // First pass: sum stored token_count, collect points that need counting
      for (const point of allPoints) {
        const payload = point.payload as QdrantPointPayload | undefined;
        if (payload?.token_count) {
          totalTokens += payload.token_count;
        } else if (payload?.text) {
          // Old data without token_count - needs counting
          pointsNeedingCount.push({ text: payload.text });
        }
      }

      // Second pass: count tokens for old data (backwards compatibility)
      if (pointsNeedingCount.length > 0) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < pointsNeedingCount.length; i += BATCH_SIZE) {
          const batch = pointsNeedingCount.slice(i, i + BATCH_SIZE);
          const tokenCounts = await Promise.all(
            batch.map((p) =>
              this.litellmService.countTokens(embeddingModel, p.text),
            ),
          );
          totalTokens += tokenCounts.reduce((sum, count) => sum + count, 0);
        }
      }

      return totalTokens;
    } catch (error) {
      this.logger.warn('Failed to calculate total indexed tokens', {
        collection,
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: utility
  // ---------------------------------------------------------------------------

  private sha1(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }
}
