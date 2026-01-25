import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Injectable } from '@nestjs/common';
import { BadRequestException, InternalException } from '@packages/common';
import { zodResponseFormat } from 'openai/helpers/zod';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { environment } from '../../../environments';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { KnowledgeChunkBoundary } from '../knowledge.types';

const QueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});
const QueryExpansionFormat = zodResponseFormat(QueryExpansionSchema, 'data');

const ChunkBoundarySchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  label: z.string().optional().nullable(),
});
const ChunkPlanSchema = z.object({
  chunks: z.array(ChunkBoundarySchema).min(1),
});

type SearchBatchItem = Parameters<QdrantService['searchMany']>[1][number];
type KnowledgeUpsertPoints = Parameters<QdrantService['upsertPoints']>[1];
type ChunkPlanAttempt = { plan: ChunkPlan | null; reason?: string };

export type ChunkMaterial = {
  text: string;
  startOffset: number;
  endOffset: number;
  label?: string | null;
  keywords?: string[] | null;
};

export type StoredChunkInput = {
  id: string;
  publicId: number;
  docId: string;
  chunkIndex: number;
  label?: string | null;
  keywords?: string[] | null;
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

type ChunkPlan = z.infer<typeof ChunkPlanSchema>;

@Injectable()
export class KnowledgeChunksService {
  constructor(
    private readonly qdrantService: QdrantService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
  ) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    return this.openaiService.embeddings({
      model: this.llmModelsService.getKnowledgeEmbeddingModel(),
      input: texts,
    });
  }

  async generateChunkPlan(content: string): Promise<ChunkPlan> {
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
      label: boundary.label ?? null,
      keywords: null,
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

    const searches = this.buildSearchBatch(
      embeddings,
      params.docIds,
      params.topK,
    );
    const batchResults = await this.qdrantService.searchMany(
      this.knowledgeCollection,
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
    chunks: ChunkMaterial[],
    embeddings: number[][],
  ): Promise<void> {
    const storedChunks = this.buildStoredChunks(docId, chunks);
    await this.qdrantService.deleteByFilter(
      this.knowledgeCollection,
      this.buildDocFilter([docId]),
    );
    await this.qdrantService.upsertPoints(
      this.knowledgeCollection,
      this.buildVectorPoints(storedChunks, embeddings),
    );
  }

  async deleteDocChunks(docId: string): Promise<void> {
    await this.qdrantService.deleteByFilter(
      this.knowledgeCollection,
      this.buildDocFilter([docId]),
    );
  }

  async getDocChunks(docId: string): Promise<StoredChunkInput[]> {
    const chunks = await this.qdrantService.scrollAll(
      this.knowledgeCollection,
      {
        filter: this.buildDocFilter([docId]),
        with_payload: true,
      } as Parameters<QdrantService['scrollAll']>[1],
    );

    return chunks
      .map((chunk) => this.parseStoredChunk(chunk))
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  private get knowledgeCollection() {
    return 'knowledge_chunks';
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

  private buildDocFilter(docIds: string[]) {
    if (docIds.length === 1) {
      return {
        must: [
          {
            key: 'docId',
            match: { value: docIds[0] },
          },
        ],
      };
    }

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
    chunks: ChunkMaterial[],
  ): StoredChunkInput[] {
    const createdAt = new Date().toISOString();
    return chunks.map((chunk, index) => ({
      id: uuidv4(),
      publicId: index + 1,
      docId,
      chunkIndex: index,
      label: chunk.label ?? null,
      keywords: chunk.keywords ?? null,
      text: chunk.text,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      createdAt,
    }));
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

    return chunks.map((chunk, index) => ({
      id: chunk.id,
      vector: embeddings[index] ?? [],
      payload: {
        docId: chunk.docId,
        publicId: chunk.publicId,
        chunkIndex: chunk.chunkIndex,
        label: chunk.label ?? null,
        keywords: chunk.keywords ?? null,
        text: chunk.text,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        createdAt: chunk.createdAt,
      },
    }));
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
      label: payload.label ?? null,
      keywords: payload.keywords ?? null,
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

    const response = await this.openaiService.response<{ queries: string[] }>(
      { message: prompt },
      {
        model: this.llmModelsService.getKnowledgeSearchModel(),
        text: {
          format: {
            ...QueryExpansionFormat.json_schema,
            schema: QueryExpansionFormat.json_schema.schema!,
            type: 'json_schema',
          },
        },
      },
      { json: true },
    );

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

  private async validateChunkPlan(
    content: string,
    plan: ChunkPlan,
  ): Promise<string | null> {
    const chunks = [...plan.chunks].sort((a, b) => a.start - b.start);
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
  ): Promise<ChunkPlan | null> {
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
      const attempt = this.buildChunkPlanFromSplits(splits, content, maxCount);
      if (!attempt.plan) {
        continue;
      }

      const error = await this.validateChunkPlan(content, attempt.plan);
      if (!error) {
        return attempt.plan;
      }
    }

    return null;
  }

  private buildChunkSizes(maxChars: number): number[] {
    const sizes: number[] = [];
    let current = maxChars;
    while (current >= 100) {
      sizes.push(Math.floor(current));
      current *= 0.8;
    }
    return Array.from(new Set(sizes));
  }

  private buildChunkPlanFromSplits(
    splits: string[],
    content: string,
    maxCount: number,
  ): ChunkPlanAttempt {
    if (splits.length === 0) {
      return { plan: null, reason: 'EMPTY_SPLITS' };
    }

    const chunks: KnowledgeChunkBoundary[] = [];
    let offset = 0;

    for (const split of splits) {
      if (!split) {
        return { plan: null, reason: 'EMPTY_SPLIT' };
      }
      const matchIndex = content.indexOf(split, offset);
      if (matchIndex === -1) {
        return { plan: null, reason: 'SPLIT_NOT_FOUND' };
      }
      const gap = content.slice(offset, matchIndex);
      if (/\S/.test(gap)) {
        return { plan: null, reason: 'GAP_NOT_WHITESPACE' };
      }

      const start = offset;
      const end = matchIndex + split.length;
      if (end <= start) {
        return { plan: null, reason: 'INVALID_SPLIT_RANGE' };
      }
      chunks.push({ start, end, label: null });
      offset = end;
      if (chunks.length > maxCount) {
        return { plan: null, reason: 'CHUNK_COUNT_EXCEEDED' };
      }
    }

    if (offset !== content.length) {
      const remainder = content.slice(offset);
      if (/\S/.test(remainder)) {
        return { plan: null, reason: 'OFFSET_MISMATCH' };
      }
      const lastChunk = chunks[chunks.length - 1];
      if (!lastChunk) {
        return { plan: null, reason: 'OFFSET_MISMATCH' };
      }
      lastChunk.end = content.length;
    }

    return { plan: { chunks } };
  }
}
