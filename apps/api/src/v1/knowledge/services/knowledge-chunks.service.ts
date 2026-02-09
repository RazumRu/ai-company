import { createHash } from 'node:crypto';

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Injectable } from '@nestjs/common';
import { BadRequestException, InternalException } from '@packages/common';
import { v5 as uuidv5 } from 'uuid';
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
import { KnowledgeChunkBoundary } from '../knowledge.types';

const QueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});

// Stable namespace for deterministic chunk point IDs (UUID v5)
const KNOWLEDGE_CHUNK_UUID_NS = '9e107d9d-372b-4b2f-8253-225585c5e162';

type SearchBatchItem = Parameters<QdrantService['searchMany']>[1][number];
type KnowledgeUpsertPoints = Parameters<QdrantService['upsertPoints']>[1];
type QdrantFilter = Parameters<QdrantService['deleteByFilter']>[1];

export type ChunkMaterial = {
  text: string;
  startOffset: number;
  endOffset: number;
  label?: string;
  keywords?: string[];
};

export type StoredChunkInput = {
  id: string;
  publicId: number;
  docId: string;
  chunkIndex: number;
  label?: string;
  keywords?: string[];
  text: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
};

export type KnowledgeIndexResult = {
  id: string;
  docId: string;
  publicId: number;
  score: number;
  text: string;
  snippet: string;
};

@Injectable()
export class KnowledgeChunksService {
  private knowledgeVectorSizePromise?: Promise<number>;

  constructor(
    private readonly qdrantService: QdrantService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly litellmService: LitellmService,
  ) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const result = await this.openaiService.embeddings({
      model: this.llmModelsService.getKnowledgeEmbeddingModel(),
      input: texts,
    });
    return result.embeddings;
  }

  async generateChunkPlan(content: string): Promise<KnowledgeChunkBoundary[]> {
    const plan = await this.buildChunkPlanFromTextSplitter(content);
    if (!plan) {
      throw new BadRequestException('INVALID_CHUNK_PLAN');
    }
    return plan;
  }

  materializeChunks(
    content: string,
    boundaries: KnowledgeChunkBoundary[],
  ): ChunkMaterial[] {
    return boundaries.map((boundary) => ({
      text: content.slice(boundary.start, boundary.end),
      startOffset: boundary.start,
      endOffset: boundary.end,
      label: boundary.label ?? undefined,
    }));
  }

  async searchChunks(params: {
    docIds: string[];
    query: string;
    topK: number;
  }): Promise<KnowledgeIndexResult[]> {
    if (!params.docIds.length) {
      return [];
    }

    const normalizedQuery = params.query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('QUERY_REQUIRED');
    }

    const queryVariants = await this.generateQueryVariants(normalizedQuery);
    const embeddings = await this.embedTexts(queryVariants);
    if (embeddings.length === 0) {
      throw new BadRequestException('EMBEDDING_FAILED');
    }

    const collection = this.qdrantService.buildSizedCollectionName(
      this.knowledgeCollection,
      this.qdrantService.getVectorSizeFromEmbeddings(embeddings),
    );
    const searches = this.buildSearchBatch(
      embeddings,
      params.docIds,
      params.topK,
    );
    const batchResults = await this.qdrantService.searchMany(
      collection,
      searches,
    );

    const chunkById = new Map<string, KnowledgeIndexResult>();
    for (const matches of batchResults) {
      for (const match of matches) {
        const payload = this.parseChunkPayload(match);
        const existing = chunkById.get(payload.id);
        if (!existing || match.score > existing.score) {
          chunkById.set(payload.id, {
            ...payload,
            score: match.score,
            snippet: '',
          });
        }
      }
    }

    const keywords = this.extractKeywords(
      [normalizedQuery, ...queryVariants].join(' '),
    );

    return Array.from(chunkById.values())
      .map((chunk) => ({
        ...chunk,
        snippet: this.buildSnippet(chunk.text, keywords),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.topK);
  }

  async upsertDocChunks(
    docId: string,
    docPublicId: number,
    chunks: ChunkMaterial[],
    embeddings: number[][],
  ): Promise<void> {
    const storedChunks = this.buildStoredChunks(docId, docPublicId, chunks);
    const collection = this.qdrantService.buildSizedCollectionName(
      this.knowledgeCollection,
      this.qdrantService.getVectorSizeFromEmbeddings(embeddings),
    );

    // Upsert first so search never returns zero results mid-update.
    // Deterministic point IDs (uuid5 from docId+chunkHash) ensure that
    // matching chunks are overwritten in-place.
    const points = this.buildVectorPoints(storedChunks, embeddings);
    await this.qdrantService.upsertPoints(collection, points);

    // Remove stale points that belong to this doc but weren't part of
    // the new upsert (e.g. doc shrank from 10 chunks to 5).
    const newPointIds = new Set(points.map((p) => String(p.id)));
    const existingPoints = await this.qdrantService.scrollAll(collection, {
      filter: this.buildDocFilter([docId]),
      with_payload: false,
    } as Parameters<QdrantService['scrollAll']>[1]);

    const staleIds = existingPoints
      .map((p) => String(p.id))
      .filter((id) => !newPointIds.has(id));

    if (staleIds.length > 0) {
      await this.qdrantService.deleteByFilter(collection, {
        must: [{ has_id: staleIds }],
      } as QdrantFilter);
    }
  }

  async deleteDocChunks(docId: string): Promise<void> {
    const collection = await this.getKnowledgeCollectionForCurrentModel();
    await this.qdrantService.deleteByFilter(
      collection,
      this.buildDocFilter([docId]),
    );
  }

  /** Resolves the Qdrant collection name used for knowledge chunks (sized by embedding dimension). */
  async getCollectionName(): Promise<string> {
    return this.getKnowledgeCollectionForCurrentModel();
  }

  async getDocChunks(docId: string): Promise<StoredChunkInput[]> {
    const collection = await this.getKnowledgeCollectionForCurrentModel();
    const chunks = await this.qdrantService.scrollAll(collection, {
      filter: this.buildDocFilter([docId]),
      with_payload: true,
    } as Parameters<QdrantService['scrollAll']>[1]);

    return chunks
      .map((chunk) => this.parseStoredChunk(chunk))
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  private get knowledgeCollection() {
    return environment.knowledgeChunksCollection ?? 'knowledge_chunks';
  }

  private async getKnowledgeCollectionForCurrentModel(): Promise<string> {
    const vectorSize = await this.getKnowledgeVectorSize();
    return this.qdrantService.buildSizedCollectionName(
      this.knowledgeCollection,
      vectorSize,
    );
  }

  private async getKnowledgeVectorSize(): Promise<number> {
    if (!this.knowledgeVectorSizePromise) {
      this.knowledgeVectorSizePromise = this.embedTexts(['ping']).then(
        (embeddings) =>
          this.qdrantService.getVectorSizeFromEmbeddings(embeddings),
      );
    }
    return this.knowledgeVectorSizePromise;
  }

  private buildSearchBatch(
    embeddings: number[][],
    docIds: string[],
    limit: number,
  ): SearchBatchItem[] {
    return embeddings.map((vector) => ({
      vector,
      limit,
      filter: this.buildDocFilter(docIds),
      with_payload: true,
      with_vector: false,
    }));
  }

  private buildDocFilter(docIds: string[]): QdrantFilter {
    return {
      must: [
        {
          key: 'docId',
          match: { any: docIds },
        },
      ],
    };
  }

  private buildStoredChunks(
    docId: string,
    docPublicId: number,
    chunks: ChunkMaterial[],
  ): StoredChunkInput[] {
    const createdAt = new Date().toISOString();
    return chunks.map((chunk, index) => ({
      id: this.buildDeterministicChunkId(docId, chunk.text),
      publicId: this.buildChunkPublicId(docPublicId, index),
      docId,
      chunkIndex: index,
      label: chunk.label,
      keywords: chunk.keywords,
      text: chunk.text,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      createdAt,
    }));
  }

  /**
   * Build a deterministic point ID so upserts overwrite the same chunk
   * rather than creating duplicates. Based on docId + content hash.
   */
  private buildDeterministicChunkId(docId: string, text: string): string {
    const contentHash = createHash('sha1').update(text).digest('hex');
    return uuidv5(`${docId}|${contentHash}`, KNOWLEDGE_CHUNK_UUID_NS);
  }

  private buildChunkPublicId(docPublicId: number, chunkIndex: number): number {
    const offset = environment.knowledgeChunkMaxCount + 1;
    return docPublicId * offset + chunkIndex + 1;
  }

  private buildVectorPoints(
    chunks: StoredChunkInput[],
    embeddings: number[][],
  ): KnowledgeUpsertPoints {
    if (chunks.length === 0) {
      return [];
    }

    if (chunks.length !== embeddings.length) {
      throw new InternalException('EMBEDDING_COUNT_MISMATCH', {
        expected: chunks.length,
        actual: embeddings.length,
      });
    }

    return chunks.map((chunk, index) => {
      const vector = embeddings[index];
      if (!vector) {
        throw new InternalException('EMBEDDING_MISSING', { index });
      }

      return {
        id: chunk.id,
        vector,
        payload: {
          docId: chunk.docId,
          publicId: chunk.publicId,
          chunkIndex: chunk.chunkIndex,
          label: chunk.label,
          keywords: chunk.keywords,
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          createdAt: chunk.createdAt,
        },
      };
    });
  }

  private parseStoredChunk(
    point: Awaited<ReturnType<QdrantService['scrollAll']>>[number],
  ): StoredChunkInput {
    const payload = (point.payload ?? {}) as StoredChunkInput;

    return {
      id: String(point.id),
      docId: payload.docId,
      publicId: payload.publicId,
      chunkIndex: payload.chunkIndex,
      label: payload.label,
      keywords: payload.keywords,
      text: payload.text,
      startOffset: payload.startOffset,
      endOffset: payload.endOffset,
      createdAt: payload.createdAt ?? new Date().toISOString(),
    };
  }

  private parseChunkPayload(
    match: Awaited<ReturnType<QdrantService['searchMany']>>[number][number],
  ): Omit<KnowledgeIndexResult, 'score' | 'snippet'> {
    const payload = (match.payload ?? {}) as StoredChunkInput;

    return {
      id: String(match.id),
      docId: payload.docId,
      publicId: payload.publicId,
      text: payload.text,
    };
  }

  private async generateQueryVariants(query: string): Promise<string[]> {
    const prompt = [
      'Generate 3-5 short search queries or keyword phrases relevant to the user query.',
      'Return ONLY JSON with key "queries": string[].',
      'Rules:',
      '- include the original query in the list.',
      '- keep each query under 12 words.',
      '- deduplicate queries.',
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
      jsonSchema: QueryExpansionSchema,
    };
    const response = supportsResponsesApi
      ? await this.openaiService.response<{ queries: string[] }>(data)
      : await this.openaiService.complete<{ queries: string[] }>(data);

    const validation = QueryExpansionSchema.safeParse(response.content);
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
  }

  private extractKeywords(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]+/g);
    if (!matches) {
      return [];
    }

    const unique = new Set<string>();
    for (const match of matches) {
      if (match.length > 2) {
        unique.add(match);
      }
    }
    return Array.from(unique);
  }

  private buildSnippet(text: string, keywords: string[]): string {
    const normalized = this.normalizeWhitespace(text);
    const keywordSnippet = this.buildKeywordSnippet(normalized, keywords);
    if (keywordSnippet) {
      return keywordSnippet;
    }

    const sentenceSnippet = this.buildBestSentenceSnippet(normalized, keywords);
    if (sentenceSnippet) {
      return sentenceSnippet;
    }

    return this.buildEdgeSnippet(normalized);
  }

  private buildKeywordSnippet(text: string, keywords: string[]): string | null {
    const KEYWORD_WINDOW = 120;

    if (keywords.length === 0) {
      return null;
    }

    const lower = text.toLowerCase();
    let bestIndex = -1;
    let bestKeyword = '';

    for (const keyword of keywords) {
      const idx = lower.indexOf(keyword.toLowerCase());
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
        bestIndex = idx;
        bestKeyword = keyword;
      }
    }

    if (bestIndex === -1) {
      return null;
    }

    const start = Math.max(0, bestIndex - KEYWORD_WINDOW);
    const end = Math.min(
      text.length,
      bestIndex + bestKeyword.length + KEYWORD_WINDOW,
    );
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
  }

  private buildBestSentenceSnippet(
    text: string,
    keywords: string[],
  ): string | null {
    const sentences = text.match(/[^.!?]+[.!?]?/g);
    if (!sentences || sentences.length === 0) {
      return null;
    }

    if (keywords.length === 0) {
      return sentences[0]?.trim() ?? null;
    }

    let bestSentence = '';
    let bestScore = 0;

    for (const sentence of sentences) {
      const lowered = sentence.toLowerCase();
      const score = keywords.reduce((sum, keyword) => {
        return lowered.includes(keyword.toLowerCase()) ? sum + 1 : sum;
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence.trim();
      }
    }

    return bestScore > 0 ? bestSentence : null;
  }

  private buildEdgeSnippet(text: string): string {
    const FALLBACK_EDGE = 250;

    if (text.length <= FALLBACK_EDGE * 2) {
      return text.trim();
    }
    const start = text.slice(0, FALLBACK_EDGE).trim();
    const end = text.slice(-FALLBACK_EDGE).trim();
    return `${start} ... ${end}`;
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private validateChunkPlan(
    content: string,
    plan: KnowledgeChunkBoundary[],
  ): string | null {
    const chunks = [...plan].sort((a, b) => a.start - b.start);
    if (chunks.length === 0) {
      return 'Chunk plan is empty';
    }
    if (chunks.length > environment.knowledgeChunkMaxCount) {
      return `Chunk count ${chunks.length} exceeds max ${environment.knowledgeChunkMaxCount}`;
    }

    const totalLen = content.length;
    const first = chunks[0];
    if (!first || first.start !== 0) {
      return 'First chunk must start at 0';
    }

    const last = chunks[chunks.length - 1];
    if (!last || last.end !== totalLen) {
      return 'Last chunk must end at document length';
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (chunk.start >= chunk.end) {
        return `Chunk ${i} has invalid offsets`;
      }
      if (chunk.start < 0 || chunk.end > totalLen) {
        return `Chunk ${i} is out of bounds`;
      }
      if (i > 0) {
        const prev = chunks[i - 1]!;
        if (chunk.start !== prev.end) {
          return `Chunk ${i} does not align with previous end`;
        }
      }
    }

    const maxChars = Math.max(200, environment.knowledgeChunkMaxTokens * 4);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const chunkLength = chunk.end - chunk.start;
      if (chunkLength > maxChars) {
        return `Chunk ${i} exceeds ${maxChars} characters`;
      }
    }

    return null;
  }

  private async buildChunkPlanFromTextSplitter(
    content: string,
  ): Promise<KnowledgeChunkBoundary[] | null> {
    const maxTokens = environment.knowledgeChunkMaxTokens;
    const maxChars = Math.max(200, maxTokens * 4);
    const maxCount = environment.knowledgeChunkMaxCount;
    const baseSeparators = [
      '\n## ',
      '\n### ',
      '\n#### ',
      '\n##### ',
      '\n###### ',
      '\n# ',
      '\n---\n',
      '\n\n',
      '\n',
      ' ',
      '',
    ];

    for (const chunkSize of this.buildChunkSizes(maxChars)) {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap: 0,
        separators: baseSeparators,
        keepSeparator: true,
      });

      const splits = await splitter.splitText(content);
      const plan = this.buildChunkPlanFromSplits(splits, content, maxCount);
      if (!plan) {
        continue;
      }

      const error = this.validateChunkPlan(content, plan);
      if (!error) {
        return plan;
      }
    }

    return null;
  }

  private buildChunkSizes(maxChars: number): number[] {
    const sizes: number[] = [];
    let current = maxChars;
    while (current >= 100) {
      const size = Math.floor(current);
      if (sizes[sizes.length - 1] !== size) {
        sizes.push(size);
      }
      current *= 0.8;
    }
    return sizes;
  }

  private buildChunkPlanFromSplits(
    splits: string[],
    content: string,
    maxCount: number,
  ): KnowledgeChunkBoundary[] | null {
    if (splits.length === 0) {
      return null;
    }

    const chunks: KnowledgeChunkBoundary[] = [];
    let offset = 0;

    for (const split of splits) {
      if (!split) {
        return null;
      }
      const matchIndex = content.indexOf(split, offset);
      if (matchIndex === -1) {
        return null;
      }
      const gap = content.slice(offset, matchIndex);
      if (/\S/.test(gap)) {
        return null;
      }

      const start = offset;
      const end = matchIndex + split.length;
      if (end <= start) {
        return null;
      }
      chunks.push({ start, end });
      offset = end;
      if (chunks.length > maxCount) {
        return null;
      }
    }

    if (offset !== content.length) {
      const remainder = content.slice(offset);
      if (/\S/.test(remainder)) {
        return null;
      }
      const lastChunk = chunks[chunks.length - 1];
      if (!lastChunk) {
        return null;
      }
      lastChunk.end = content.length;
    }

    return chunks;
  }
}
