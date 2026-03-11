import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { OpenaiService } from '../../../../openai/openai.service';
import { KnowledgeSearchDocsTool } from './knowledge-search-docs.tool';

describe('KnowledgeSearchDocsTool', () => {
  let tool: KnowledgeSearchDocsTool;
  let docDao: { getAll: ReturnType<typeof vi.fn> };
  let openaiService: { jsonRequest: ReturnType<typeof vi.fn> };
  let llmModelsService: {
    getKnowledgeSearchModel: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    docDao = { getAll: vi.fn() };
    openaiService = { jsonRequest: vi.fn() };
    llmModelsService = {
      getKnowledgeSearchModel: vi.fn().mockReturnValue('test-model'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeSearchDocsTool,
        { provide: KnowledgeDocDao, useValue: docDao },
        { provide: OpenaiService, useValue: openaiService },
        { provide: LlmModelsService, useValue: llmModelsService },
      ],
    }).compile();

    tool = await module.resolve(KnowledgeSearchDocsTool);
  });

  it('returns descriptive comment when knowledge base is empty', async () => {
    docDao.getAll.mockResolvedValue([]);

    const result = await tool.invoke(
      { task: 'Find authentication docs' },
      {},
      {
        configurable: { graph_created_by: 'user-1', thread_id: 'thread-1' },
      },
    );

    expect(result.output.documents).toEqual([]);
    expect(result.output.comment).toBe(
      'No knowledge documents have been added to this project. The knowledge base is empty — do not retry with a different query.',
    );
  });

  it('does not call LLM when knowledge base is empty', async () => {
    docDao.getAll.mockResolvedValue([]);

    await tool.invoke(
      { task: 'Find authentication docs' },
      {},
      {
        configurable: { graph_created_by: 'user-1', thread_id: 'thread-1' },
      },
    );

    expect(openaiService.jsonRequest).not.toHaveBeenCalled();
  });

  it('returns selected documents when docs exist', async () => {
    const mockDocs = [
      {
        id: 'doc-1',
        publicId: 101,
        title: 'Auth Guide',
        summary: 'Authentication documentation',
        politic: null,
        tags: ['auth'],
        updatedAt: new Date(),
      },
    ];
    docDao.getAll.mockResolvedValue(mockDocs);
    openaiService.jsonRequest.mockResolvedValue({
      content: { ids: [101], comment: 'Found relevant auth doc' },
    });

    const result = await tool.invoke(
      { task: 'Implement authentication' },
      {},
      {
        configurable: { graph_created_by: 'user-1', thread_id: 'thread-1' },
      },
    );

    expect(result.output.documents).toHaveLength(1);
    expect(result.output.documents[0]?.documentPublicId).toBe(101);
    expect(result.output.documents[0]?.title).toBe('Auth Guide');
    expect(result.output.comment).toBe('Found relevant auth doc');
  });

  it('throws when graph_created_by is missing', async () => {
    await expect(
      tool.invoke({ task: 'Find docs' }, {}, { configurable: {} }),
    ).rejects.toThrow('graph_created_by is required');
  });

  it('throws TASK_REQUIRED when task is whitespace only', async () => {
    await expect(
      tool.invoke(
        { task: '   ' },
        {},
        {
          configurable: { graph_created_by: 'user-1', thread_id: 'thread-1' },
        },
      ),
    ).rejects.toThrow('TASK_REQUIRED');
  });
});
