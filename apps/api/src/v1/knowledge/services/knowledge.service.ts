import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isUndefined, pickBy } from 'lodash';
import { zodResponseFormat } from 'openai/helpers/zod';
import { EntityManager } from 'typeorm';
import { z } from 'zod';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { KnowledgeDocDao } from '../dao/knowledge-doc.dao';
import {
  KnowledgeDocDto,
  KnowledgeDocInput,
  KnowledgeDocListQuery,
} from '../dto/knowledge.dto';
import { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';
import { KnowledgeChunkBoundary, KnowledgeSummary } from '../knowledge.types';
import {
  ChunkMaterial,
  KnowledgeChunksService,
} from './knowledge-chunks.service';

const KnowledgeSummarySchema = z.object({
  summary: z.string().min(1),
});
const KnowledgeSummaryFormat = zodResponseFormat(
  KnowledgeSummarySchema,
  'data',
);

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly typeorm: TypeormService,
    private readonly authContext: AuthContextService,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly knowledgeChunksService: KnowledgeChunksService,
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
      await this.docDao.deleteById(id, entityManager);
    });

    await this.knowledgeChunksService.deleteDocChunks(id);
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
      this.knowledgeChunksService.generateChunkPlan(content),
    ]);
    const tags = this.normalizeTags(dto.tags ?? []);
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

    let chunkPlan: KnowledgeChunkBoundary[] | null = null;
    if (dto.content) {
      const [summary, plan] = await Promise.all([
        this.generateSummary(dto.content),
        this.knowledgeChunksService.generateChunkPlan(dto.content),
      ]);
      updateData.summary = summary;
      chunkPlan = plan;
    }

    if (dto.tags) {
      updateData.tags = this.normalizeTags(dto.tags);
    }

    const { updated, embeddings, chunkInputs } = await this.typeorm.trx(
      async (entityManager: EntityManager) => {
        const updated = await this.docDao.updateById(
          id,
          updateData,
          entityManager,
        );

        if (!updated) {
          throw new NotFoundException('KNOWLEDGE_DOC_NOT_FOUND');
        }

        let chunkInputs: ChunkMaterial[] = [];
        let embeddings: number[][] = [];
        if (dto.content) {
          const plan =
            chunkPlan ??
            (await this.knowledgeChunksService.generateChunkPlan(dto.content));
          const chunks = this.knowledgeChunksService.materializeChunks(
            dto.content,
            plan,
          );
          embeddings = await this.knowledgeChunksService.embedTexts(
            chunks.map((c) => c.text),
          );
          chunkInputs = chunks;
        }

        return { updated, chunkInputs, embeddings };
      },
    );

    if (dto.content) {
      await this.knowledgeChunksService.upsertDocChunks(
        id,
        updated.publicId,
        chunkInputs,
        embeddings,
      );
    }

    return this.prepareDocResponse(updated);
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
        ...(await this.llmModelsService.getKnowledgeMetadataParams()),
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
}
