import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isUndefined, pickBy } from 'lodash';
import { EntityManager } from 'typeorm';
import { z } from 'zod';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { KnowledgeDocDao } from '../dao/knowledge-doc.dao';
import {
  KnowledgeDocCreateDto,
  KnowledgeDocDto,
  KnowledgeDocListQuery,
  KnowledgeDocUpdateDto,
} from '../dto/knowledge.dto';
import { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';
import { KnowledgeSummary } from '../knowledge.types';
import {
  MAX_TAGS,
  normalizeFilterTags,
  normalizeTags,
} from '../knowledge.utils';
import {
  ChunkMaterial,
  KnowledgeChunksService,
} from './knowledge-chunks.service';

const FALLBACK_SUMMARY_LENGTH = 500;

const KnowledgeSummarySchema = z.object({
  summary: z.string().min(1),
});

export type KnowledgeDocListResult = {
  items: KnowledgeDocDto[];
  total: number;
};

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly typeorm: TypeormService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly knowledgeChunksService: KnowledgeChunksService,
  ) {}

  async createDoc(
    ctx: AuthContextStorage,
    dto: KnowledgeDocCreateDto,
  ): Promise<KnowledgeDocDto> {
    const userId = ctx.checkSub();

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('CONTENT_REQUIRED');
    }

    const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const [summary, plan] = await Promise.all([
      this.generateSummary(content),
      this.knowledgeChunksService.generateChunkPlan(content),
    ]);
    const tags = normalizeTags(dto.tags ?? [], MAX_TAGS);
    const chunks = this.knowledgeChunksService.materializeChunks(content, plan);
    const embeddings = await this.knowledgeChunksService.embedTexts(
      chunks.map((c) => c.text),
    );

    const doc = await this.typeorm.trx(async (entityManager: EntityManager) => {
      const doc = await this.docDao.create(
        {
          content,
          title: dto.title,
          summary,
          politic: dto.politic,
          embeddingModel,
          tags,
          createdBy: userId,
        },
        entityManager,
      );
      return doc;
    });

    await this.knowledgeChunksService.upsertDocChunks(
      doc.id,
      doc.publicId,
      chunks,
      embeddings,
    );

    return this.prepareDocResponse(doc);
  }

  async updateDoc(
    ctx: AuthContextStorage,
    id: string,
    dto: KnowledgeDocUpdateDto,
  ): Promise<KnowledgeDocDto> {
    const userId = ctx.checkSub();

    const existing = await this.docDao.getOne({ id, createdBy: userId });
    if (!existing) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }

    const updateData: Partial<KnowledgeDocEntity> = pickBy(
      { ...dto, tags: dto.tags ?? undefined },
      (v) => !isUndefined(v),
    );

    let chunks: ChunkMaterial[] = [];
    let embeddings: number[][] = [];

    if (dto.content) {
      const embeddingModel = this.llmModelsService.getKnowledgeEmbeddingModel();
      const [summary, plan] = await Promise.all([
        this.generateSummary(dto.content),
        this.knowledgeChunksService.generateChunkPlan(dto.content),
      ]);
      updateData.summary = summary;
      updateData.embeddingModel = embeddingModel;
      chunks = this.knowledgeChunksService.materializeChunks(dto.content, plan);
      embeddings = await this.knowledgeChunksService.embedTexts(
        chunks.map((c) => c.text),
      );
    }

    if (dto.tags) {
      updateData.tags = normalizeTags(dto.tags, MAX_TAGS);
    }

    const updated = await this.typeorm.trx(
      async (entityManager: EntityManager) => {
        const updated = await this.docDao.updateById(
          id,
          updateData,
          entityManager,
        );

        if (!updated) {
          throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
        }

        return updated;
      },
    );

    if (dto.content) {
      await this.knowledgeChunksService.upsertDocChunks(
        id,
        updated.publicId,
        chunks,
        embeddings,
      );
    }

    return this.prepareDocResponse(updated);
  }

  async deleteDoc(ctx: AuthContextStorage, id: string): Promise<void> {
    const userId = ctx.checkSub();

    const existing = await this.docDao.getOne({ id, createdBy: userId });
    if (!existing) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }

    // Delete from Qdrant first — if this fails, the DB record still exists
    // and the operation can be retried. The reverse order would leave
    // orphan vectors in Qdrant with no DB record to reference.
    await this.knowledgeChunksService.deleteDocChunks(id);

    await this.typeorm.trx(async (entityManager: EntityManager) => {
      await this.docDao.deleteById(id, entityManager);
    });
  }

  async listDocs(
    ctx: AuthContextStorage,
    query: KnowledgeDocListQuery,
  ): Promise<KnowledgeDocListResult> {
    const userId = ctx.checkSub();

    const tags = normalizeFilterTags(query.tags);

    const searchParams = {
      createdBy: userId,
      tags,
      search: query.search,
      order: { updatedAt: 'DESC' as const },
    };

    const [rows, total] = await Promise.all([
      this.docDao.getAll({
        ...searchParams,
        limit: query.limit,
        offset: query.offset,
      }),
      this.docDao.count(searchParams),
    ]);

    return {
      items: rows.map((row) => this.prepareDocResponse(row)),
      total,
    };
  }

  async getDoc(ctx: AuthContextStorage, id: string): Promise<KnowledgeDocDto> {
    const userId = ctx.checkSub();

    const doc = await this.docDao.getOne({ id, createdBy: userId });
    if (!doc) {
      throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
    }
    return this.prepareDocResponse(doc);
  }

  private prepareDocResponse(entity: KnowledgeDocEntity): KnowledgeDocDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      tags: entity.tags ?? [],
      summary: entity.summary ?? null,
      politic: entity.politic ?? null,
      embeddingModel: entity.embeddingModel ?? null,
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

    const modelParams =
      await this.llmModelsService.getKnowledgeMetadataParams();
    const modelName =
      typeof modelParams.model === 'string'
        ? modelParams.model
        : String(modelParams.model);

    const response = await this.openaiService.jsonRequest<KnowledgeSummary>({
      model: modelName,
      message: prompt,
      jsonSchema: KnowledgeSummarySchema,
      ...(modelParams.reasoning ? { reasoning: modelParams.reasoning } : {}),
    });

    const validation = KnowledgeSummarySchema.safeParse(response.content);
    if (!validation.success) {
      return this.buildFallbackSummary(content);
    }

    return validation.data.summary;
  }

  private buildFallbackSummary(content: string): string {
    const summary = content.trim().slice(0, FALLBACK_SUMMARY_LENGTH);
    return summary.length ? summary : 'No summary available.';
  }
}
