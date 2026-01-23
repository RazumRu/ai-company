import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isUndefined, pickBy } from 'lodash';
import { zodResponseFormat } from 'openai/helpers/zod';
import { EntityManager } from 'typeorm';
import { z } from 'zod';

import { environment } from '../../../environments';
import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { KnowledgeChunkDao } from '../dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../dao/knowledge-doc.dao';
import {
  KnowledgeChunkDto,
  KnowledgeDocDto,
  KnowledgeDocInput,
  KnowledgeDocListQuery,
} from '../dto/knowledge.dto';
import { KnowledgeChunkEntity } from '../entity/knowledge-chunk.entity';
import { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';
import { KnowledgeChunkBoundary, KnowledgeSummary } from '../knowledge.types';

const KnowledgeSummarySchema = z.object({
  summary: z.string().min(1),
});
const KnowledgeSummaryFormat = zodResponseFormat(
  KnowledgeSummarySchema,
  'data',
);

const ChunkBoundarySchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  label: z.string().optional().nullable(),
});

const ChunkPlanSchema = z.object({
  chunks: z.array(ChunkBoundarySchema).min(1),
});
const ChunkPlanFormat = zodResponseFormat(ChunkPlanSchema, 'data');

type ChunkPlan = z.infer<typeof ChunkPlanSchema>;

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly chunkDao: KnowledgeChunkDao,
    private readonly typeorm: TypeormService,
    private readonly authContext: AuthContextService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly litellmService: LitellmService,
  ) {}

  async createDoc(dto: KnowledgeDocInput): Promise<KnowledgeDocDto> {
    const userId = this.authContext.checkSub();
    return this.createDocForUser(userId, dto);
  }

  async updateDoc(
    id: string,
    dto: KnowledgeDocInput,
  ): Promise<KnowledgeDocDto> {
    const userId = this.authContext.checkSub();
    return this.updateDocForUser(userId, id, dto);
  }

  async deleteDoc(id: string): Promise<void> {
    const userId = this.authContext.checkSub();

    const existing = await this.docDao.getOne({ id, createdBy: userId });
    if (!existing) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }

    await this.typeorm.trx(async (entityManager: EntityManager) => {
      await this.chunkDao.hardDelete({ docId: id }, entityManager);
      await this.docDao.deleteById(id, entityManager);
    });
  }

  async listDocs(query: KnowledgeDocListQuery): Promise<KnowledgeDocDto[]> {
    const userId = this.authContext.checkSub();
    const tags = this.normalizeFilterTags(query.tags);

    const rows = await this.docDao.getAll({
      createdBy: userId,
      tags,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      order: { updatedAt: 'DESC' },
    });

    return rows.map((row) => this.prepareDocResponse(row));
  }

  async getDoc(id: string): Promise<KnowledgeDocDto> {
    const userId = this.authContext.checkSub();
    const doc = await this.docDao.getOne({ id, createdBy: userId });
    if (!doc) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }
    return this.prepareDocResponse(doc);
  }

  async getDocChunks(id: string): Promise<KnowledgeChunkDto[]> {
    const userId = this.authContext.checkSub();
    const doc = await this.docDao.getOne({ id, createdBy: userId });
    if (!doc) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }

    const chunks = await this.chunkDao.getAll({
      docId: id,
      order: { chunkIndex: 'ASC' },
    });

    return chunks.map((chunk) => this.prepareChunkResponse(chunk));
  }

  private async createDocForUser(
    userId: string,
    dto: KnowledgeDocInput,
  ): Promise<KnowledgeDocDto> {
    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('CONTENT_REQUIRED');
    }

    const [summary, plan] = await Promise.all([
      this.generateSummary(content),
      this.generateChunkPlan(content),
    ]);
    const tags = this.normalizeTags(dto.tags ?? []);
    const chunks = this.materializeChunks(content, plan.chunks);
    const embeddings = await this.embedTexts(chunks.map((c) => c.text));

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const doc = await this.docDao.create(
        {
          content,
          title: dto.title,
          summary,
          politic: dto.politic,
          tags,
          createdBy: userId,
        },
        entityManager,
      );

      const chunkRows = chunks.map((chunk, index) => ({
        docId: doc.id,
        chunkIndex: index,
        label: chunk.label ?? null,
        keywords: chunk.keywords ?? null,
        text: chunk.text,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        embedding: embeddings[index] ?? null,
      }));

      if (chunkRows.length > 0) {
        await this.chunkDao.createMany(chunkRows, entityManager);
      }

      return this.prepareDocResponse(doc);
    });
  }

  private async updateDocForUser(
    userId: string,
    id: string,
    dto: KnowledgeDocInput,
  ): Promise<KnowledgeDocDto> {
    const existing = await this.docDao.getOne({ id, createdBy: userId });
    if (!existing) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }

    const updateData = pickBy(dto, (v) => !isUndefined(v));

    let chunkPlan: ChunkPlan | null = null;
    if (dto.content) {
      const [summary, plan] = await Promise.all([
        this.generateSummary(dto.content),
        this.generateChunkPlan(dto.content),
      ]);
      updateData.summary = summary;
      chunkPlan = plan;
    }

    if (dto.tags) {
      updateData.tags = this.normalizeTags(dto.tags);
    }

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const updated = await this.docDao.updateById(
        id,
        updateData,
        entityManager,
      );

      if (!updated) {
        throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
      }

      if (dto.content) {
        const plan = chunkPlan ?? (await this.generateChunkPlan(dto.content));
        const chunks = this.materializeChunks(dto.content, plan.chunks);
        const embeddings = await this.embedTexts(chunks.map((c) => c.text));

        await this.chunkDao.hardDelete({ docId: id }, entityManager);
        const chunkRows = chunks.map((chunk, index) => ({
          docId: id,
          chunkIndex: index,
          label: chunk.label ?? null,
          keywords: chunk.keywords ?? null,
          text: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embedding: embeddings[index] ?? null,
        }));

        if (chunkRows.length > 0) {
          await this.chunkDao.createMany(chunkRows, entityManager);
        }
      }

      return this.prepareDocResponse(updated);
    });
  }

  private prepareDocResponse(entity: KnowledgeDocEntity): KnowledgeDocDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      tags: entity.tags ?? [],
      summary: entity.summary ?? null,
      politic: entity.politic ?? null,
    };
  }

  private prepareChunkResponse(
    entity: KnowledgeChunkEntity,
  ): KnowledgeChunkDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      label: entity.label ?? null,
      keywords: entity.keywords ?? null,
    };
  }

  private async generateSummary(content: string): Promise<string> {
    const prompt = [
      'You generate summaries for internal knowledge base documents.',
      'Return ONLY JSON with key: summary.',
      'Rules:',
      '- summary: 2-5 lines, concise.',
      '',
      'DOCUMENT:',
      content,
    ].join('\n');

    const response = await this.openaiService.response<KnowledgeSummary>(
      { message: prompt },
      {
        model: this.llmModelsService.getKnowledgeMetadataModel(),
        reasoning: { effort: 'medium' },
        text: {
          format: {
            ...KnowledgeSummaryFormat.json_schema,
            schema: KnowledgeSummaryFormat.json_schema.schema!,
            type: 'json_schema',
          },
        },
      },
      { json: true },
    );

    const validation = KnowledgeSummarySchema.safeParse(response.content);
    if (!validation.success) {
      return this.buildFallbackSummary(content);
    }

    return validation.data.summary;
  }

  private buildFallbackSummary(content: string): string {
    const summary = content.trim().slice(0, 500);
    return summary.length ? summary : 'No summary available.';
  }

  private normalizeTags(tags: string[]): string[] {
    const normalized = tags
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(normalized)).slice(0, 12);
  }

  private normalizeFilterTags(tags?: string[]): string[] | undefined {
    if (!tags || tags.length === 0) {
      return undefined;
    }
    return Array.from(
      new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
    );
  }

  private async generateChunkPlan(content: string): Promise<ChunkPlan> {
    const attempt = async (fix?: { reason: string; previous: ChunkPlan }) => {
      const plan = await this.requestChunkPlan(content, fix);
      if (!plan) {
        return { plan: null, error: 'LLM_OUTPUT_INVALID' };
      }
      const error = await this.validateChunkPlan(content, plan);
      return { plan, error };
    };

    const first = await attempt();
    if (!first.error && first.plan) {
      return first.plan;
    }

    const previous = first.plan ?? { chunks: [] };
    const second = await attempt({
      reason: first.error ?? 'INVALID_CHUNK_PLAN',
      previous,
    });

    if (!second.error && second.plan) {
      return second.plan;
    }

    throw new BadRequestException(
      'INVALID_CHUNK_PLAN',
      second.error ?? 'INVALID_CHUNK_PLAN',
    );
  }

  private async requestChunkPlan(
    content: string,
    fix?: { reason: string; previous: ChunkPlan },
  ): Promise<ChunkPlan | null> {
    const basePrompt = [
      'You split a document into semantic chunks WITHOUT rewriting.',
      'Return ONLY JSON with key "chunks": [{ start, end, label? }].',
      'Rules:',
      '- start/end are character offsets into the ORIGINAL document.',
      '- cover the full document from 0 to len(text) with no gaps or overlaps.',
      '- do not exceed max chunk size in tokens.',
      '- do not create empty chunks.',
      '',
      `MAX_TOKENS_PER_CHUNK: ${environment.knowledgeChunkMaxTokens}`,
      `DOCUMENT_LENGTH: ${content.length}`,
      '',
      'DOCUMENT:',
      content,
    ];

    const prompt = fix
      ? [
          ...basePrompt,
          '',
          'PREVIOUS_CHUNKS:',
          JSON.stringify(fix.previous),
          `ERROR: ${fix.reason}`,
          'Fix the chunk boundaries and return JSON only.',
        ].join('\n')
      : basePrompt.join('\n');

    const response = await this.openaiService.response<ChunkPlan>(
      { message: prompt },
      {
        model: this.llmModelsService.getKnowledgeChunkingModel(),
        reasoning: { effort: 'low' },
        text: {
          format: {
            ...ChunkPlanFormat.json_schema,
            schema: ChunkPlanFormat.json_schema.schema!,
            type: 'json_schema',
          },
        },
      },
      { json: true },
    );

    const validation = ChunkPlanSchema.safeParse(response.content);
    if (!validation.success) {
      return null;
    }
    return validation.data;
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
    if (chunks[0]?.start !== 0) {
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

    const tooLarge = await this.findOversizedChunk(content, chunks);
    if (tooLarge !== null) {
      return `Chunk ${tooLarge} exceeds ${environment.knowledgeChunkMaxTokens} tokens`;
    }

    return null;
  }

  private async findOversizedChunk(
    content: string,
    chunks: KnowledgeChunkBoundary[],
  ): Promise<number | null> {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const text = content.slice(chunk.start, chunk.end);
      const tokens = await this.litellmService.countTokens(
        this.llmModelsService.getKnowledgeChunkingModel(),
        text,
      );
      if (tokens > environment.knowledgeChunkMaxTokens) {
        return i;
      }
    }
    return null;
  }

  private materializeChunks(
    content: string,
    boundaries: KnowledgeChunkBoundary[],
  ): {
    text: string;
    startOffset: number;
    endOffset: number;
    label?: string | null;
    keywords?: string[] | null;
  }[] {
    return boundaries.map((boundary) => ({
      text: content.slice(boundary.start, boundary.end),
      startOffset: boundary.start,
      endOffset: boundary.end,
      label: boundary.label ?? null,
      keywords: null,
    }));
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.openaiService.embeddings({
      model: this.llmModelsService.getKnowledgeEmbeddingModel(),
      input: texts,
    });
  }
}
