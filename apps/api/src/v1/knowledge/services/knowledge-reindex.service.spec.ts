import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { KnowledgeDocDao } from '../dao/knowledge-doc.dao';
import type { KnowledgeDocEntity } from '../entity/knowledge-doc.entity';
import { KnowledgeChunksService } from './knowledge-chunks.service';
import { KnowledgeReindexService } from './knowledge-reindex.service';

describe('KnowledgeReindexService', () => {
  let service: KnowledgeReindexService;
  let docDao: {
    getEmbeddingModelMismatches: ReturnType<typeof vi.fn>;
    updateById: ReturnType<typeof vi.fn>;
  };
  let llmModelsService: {
    getKnowledgeEmbeddingModel: ReturnType<typeof vi.fn>;
  };
  let knowledgeChunksService: {
    generateChunkPlan: ReturnType<typeof vi.fn>;
    materializeChunks: ReturnType<typeof vi.fn>;
    embedTexts: ReturnType<typeof vi.fn>;
    upsertDocChunks: ReturnType<typeof vi.fn>;
  };
  let logger: {
    log: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    docDao = {
      getEmbeddingModelMismatches: vi.fn(),
      updateById: vi.fn(),
    };
    llmModelsService = {
      getKnowledgeEmbeddingModel: vi.fn().mockReturnValue('embed-model'),
    };
    knowledgeChunksService = {
      generateChunkPlan: vi.fn(),
      materializeChunks: vi.fn(),
      embedTexts: vi.fn(),
      upsertDocChunks: vi.fn(),
    };
    logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    service = new KnowledgeReindexService(
      docDao as unknown as KnowledgeDocDao,
      llmModelsService as unknown as LlmModelsService,
      knowledgeChunksService as unknown as KnowledgeChunksService,
      logger as unknown as DefaultLogger,
    );
  });

  it('returns early when no mismatched docs', async () => {
    docDao.getEmbeddingModelMismatches.mockResolvedValue([]);

    await service.reindexDocsWithEmbeddingModelMismatch();

    expect(docDao.getEmbeddingModelMismatches).toHaveBeenCalledWith(
      'embed-model',
    );
    expect(knowledgeChunksService.generateChunkPlan).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('reindexes a doc with valid content', async () => {
    const doc = {
      id: 'doc-1',
      publicId: 10,
      content: 'Hello world',
    } as KnowledgeDocEntity;

    docDao.getEmbeddingModelMismatches.mockResolvedValue([doc]);
    knowledgeChunksService.generateChunkPlan.mockResolvedValue([
      { start: 0, end: 5 },
    ]);
    knowledgeChunksService.materializeChunks.mockReturnValue([
      { text: 'Hello', startOffset: 0, endOffset: 5 },
    ]);
    knowledgeChunksService.embedTexts.mockResolvedValue([[0.1, 0.2]]);

    await service.reindexDocsWithEmbeddingModelMismatch();

    expect(knowledgeChunksService.generateChunkPlan).toHaveBeenCalledWith(
      'Hello world',
    );
    expect(knowledgeChunksService.embedTexts).toHaveBeenCalledWith(['Hello']);
    expect(knowledgeChunksService.upsertDocChunks).toHaveBeenCalledWith(
      doc.id,
      doc.publicId,
      [{ text: 'Hello', startOffset: 0, endOffset: 5 }],
      [[0.1, 0.2]],
    );
    expect(docDao.updateById).toHaveBeenCalledWith(doc.id, {
      embeddingModel: 'embed-model',
    });
  });

  it('skips empty content docs and logs warning', async () => {
    const doc = {
      id: 'doc-2',
      publicId: 11,
      content: '   ',
    } as KnowledgeDocEntity;

    docDao.getEmbeddingModelMismatches.mockResolvedValue([doc]);

    await service.reindexDocsWithEmbeddingModelMismatch();

    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping knowledge doc reindex with empty content',
      { docId: doc.id },
    );
    expect(knowledgeChunksService.generateChunkPlan).not.toHaveBeenCalled();
    expect(docDao.updateById).not.toHaveBeenCalled();
  });

  it('continues reindexing after an error', async () => {
    const badDoc = {
      id: 'doc-bad',
      publicId: 1,
      content: 'Bad',
    } as KnowledgeDocEntity;
    const goodDoc = {
      id: 'doc-good',
      publicId: 2,
      content: 'Good content',
    } as KnowledgeDocEntity;

    docDao.getEmbeddingModelMismatches.mockResolvedValue([badDoc, goodDoc]);
    knowledgeChunksService.generateChunkPlan.mockImplementation(
      async (content: string) => {
        if (content === 'Bad') {
          throw new Error('boom');
        }
        return [{ start: 0, end: 4 }];
      },
    );
    knowledgeChunksService.materializeChunks.mockReturnValue([
      { text: 'Good', startOffset: 0, endOffset: 4 },
    ]);
    knowledgeChunksService.embedTexts.mockResolvedValue([[0.3, 0.4]]);

    await service.reindexDocsWithEmbeddingModelMismatch();

    expect(logger.error).toHaveBeenCalled();
    expect(docDao.updateById).toHaveBeenCalledWith(goodDoc.id, {
      embeddingModel: 'embed-model',
    });
  });
});
