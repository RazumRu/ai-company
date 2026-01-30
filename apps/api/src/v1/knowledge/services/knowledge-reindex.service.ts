import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { KnowledgeDocDao } from '../dao/knowledge-doc.dao';
import { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';
import { KnowledgeChunksService } from './knowledge-chunks.service';

@Injectable()
export class KnowledgeReindexService {
  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly llmModelsService: LlmModelsService,
    private readonly knowledgeChunksService: KnowledgeChunksService,
    private readonly logger: DefaultLogger,
  ) {}

  async reindexDocsWithEmbeddingModelMismatch(): Promise<void> {
    const currentModel = this.llmModelsService.getKnowledgeEmbeddingModel();
    const docs = await this.docDao.getEmbeddingModelMismatches(currentModel);
    if (!currentModel || !docs.length) {
      return;
    }

    this.logger.log('Reindexing knowledge docs for embedding model mismatch', {
      currentModel,
      count: docs.length,
    });

    const concurrency = 4;
    await this.runWithConcurrency(docs, concurrency, async (doc) => {
      try {
        await this.reindexDoc(doc, currentModel);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(err, 'Failed to reindex knowledge doc', {
          docId: doc.id,
        });
      }
    });
  }

  private async reindexDoc(
    doc: KnowledgeDocEntity,
    embeddingModel: string,
  ): Promise<void> {
    const content = doc.content.trim();
    if (!content) {
      this.logger.warn('Skipping knowledge doc reindex with empty content', {
        docId: doc.id,
      });
      return;
    }

    const plan = await this.knowledgeChunksService.generateChunkPlan(content);
    const chunks = this.knowledgeChunksService.materializeChunks(content, plan);
    const embeddings = await this.knowledgeChunksService.embedTexts(
      chunks.map((c) => c.text),
    );

    await this.knowledgeChunksService.upsertDocChunks(
      doc.id,
      doc.publicId,
      chunks,
      embeddings,
    );

    await this.docDao.updateById(doc.id, { embeddingModel });
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    handler: (item: T) => Promise<void>,
  ): Promise<void> {
    const queue = [...items];
    const workers = Array.from(
      { length: Math.min(limit, queue.length) },
      async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) return;
          await handler(item);
        }
      },
    );

    await Promise.all(workers);
  }
}
