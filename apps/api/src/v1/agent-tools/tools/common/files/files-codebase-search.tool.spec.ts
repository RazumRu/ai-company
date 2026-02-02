import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import type { RequestTokenUsage } from '../../../../litellm/litellm.types';
import { LitellmService } from '../../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { OpenaiService } from '../../../../openai/openai.service';
import { QdrantService } from '../../../../qdrant/services/qdrant.service';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';

describe('FilesCodebaseSearchTool', () => {
  let tool: FilesCodebaseSearchTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: FilesBaseToolConfig;
  let mockQdrantService: QdrantService;
  let mockOpenaiService: OpenaiService;
  let mockModelsService: LlmModelsService;
  let mockLitellmService: LitellmService;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

    mockConfig = {
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as any,
    };

    mockQdrantService = {
      buildSizedCollectionName: vi.fn((base: string, size: number) => {
        return `${base}_${size}`;
      }),
      getVectorSizeFromEmbeddings: vi.fn().mockReturnValue(2),
      searchPoints: vi.fn().mockResolvedValue([]),
      retrievePoints: vi.fn().mockResolvedValue([]),
      upsertPoints: vi.fn().mockResolvedValue(undefined),
      deleteByFilter: vi.fn().mockResolvedValue(undefined),
    } as unknown as QdrantService;

    mockOpenaiService = {
      embeddings: vi.fn().mockResolvedValue({ embeddings: [[0, 0]] }),
    } as unknown as OpenaiService;

    mockModelsService = {
      getKnowledgeEmbeddingModel: vi.fn().mockReturnValue('test-embedding'),
    } as unknown as LlmModelsService;

    mockLitellmService = {
      sumTokenUsages: vi.fn(
        (usages: (RequestTokenUsage | null | undefined)[]) => {
          let inputTokens = 0;
          let outputTokens = 0;
          let totalTokens = 0;
          let totalPrice = 0;
          let sawAny = false;
          for (const usage of usages) {
            if (!usage) continue;
            sawAny = true;
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
            totalTokens += usage.totalTokens;
            totalPrice += usage.totalPrice ?? 0;
          }
          return sawAny
            ? { inputTokens, outputTokens, totalTokens, totalPrice }
            : null;
        },
      ),
    } as unknown as LitellmService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesCodebaseSearchTool,
        { provide: QdrantService, useValue: mockQdrantService },
        { provide: OpenaiService, useValue: mockOpenaiService },
        { provide: LitellmService, useValue: mockLitellmService },
        { provide: LlmModelsService, useValue: mockModelsService },
      ],
    }).compile();

    tool = module.get<FilesCodebaseSearchTool>(FilesCodebaseSearchTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('codebase_search');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Semantic search');
      expect(tool.description).toContain('Qdrant');
    });
  });

  describe('schema', () => {
    it('should validate required query field', () => {
      expect(() => tool.validate({ query: 'find auth' })).not.toThrow();
    });

    it('should reject missing query field', () => {
      expect(() => tool.validate({})).toThrow();
    });

    it('should reject empty query field', () => {
      expect(() => tool.validate({ query: '' })).toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should return error when not in git repo', async () => {
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal: not a git repository',
        execPath: '',
      });

      const { output } = await tool.invoke(
        { query: 'search term' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain('requires a cloned git repository');
      expect(output.results).toBeUndefined();
    });

    it('should return filtered search results', async () => {
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'abc123',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'git@github.com:org/repo.git',
          stderr: '',
          execPath: '',
        });

      const signatureHash = (tool as any).getChunkingSignatureHash();
      vi.spyOn(tool as any, 'getIndexState').mockResolvedValue({
        repo_id: 'https://github.com/org/repo',
        last_indexed_commit: 'abc123',
        last_indexed_at: '2024-01-01T00:00:00.000Z',
        embedding_model: 'test-embedding',
        vector_size: 2,
        chunking_signature_hash: signatureHash,
      });

      (
        mockQdrantService.searchPoints as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        {
          id: '1',
          score: 0.9,
          payload: {
            repo_id: 'https://github.com/org/repo',
            path: 'apps/api/src/index.ts',
            language: 'ts',
            start_line: 1,
            end_line: 10,
            text: 'const value = 1;',
          },
        },
        {
          id: '2',
          score: 0.5,
          payload: {
            repo_id: 'https://github.com/org/repo',
            path: 'docs/readme.md',
            language: 'md',
            start_line: 1,
            end_line: 3,
            text: 'Readme content',
          },
        },
      ]);

      const { output } = await tool.invoke(
        {
          query: 'index',
          path_prefix: 'apps/api',
          language: 'ts',
          top_k: 5,
        },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBeUndefined();
      expect(output.results).toHaveLength(1);
      expect(output.results?.[0]?.path).toBe('apps/api/src/index.ts');
      expect(mockQdrantService.searchPoints).toHaveBeenCalledTimes(1);
      expect(mockQdrantService.buildSizedCollectionName).toHaveBeenCalledWith(
        'codebase_https_github_com_org_repo',
        2,
      );
    });

    it('should trigger incremental index when commits differ', async () => {
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'newcommit',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'https://github.com/org/repo',
          stderr: '',
          execPath: '',
        });

      const signatureHash = (tool as any).getChunkingSignatureHash();
      vi.spyOn(tool as any, 'getIndexState').mockResolvedValue({
        repo_id: 'https://github.com/org/repo',
        last_indexed_commit: 'oldcommit',
        last_indexed_at: '2024-01-01T00:00:00.000Z',
        embedding_model: 'test-embedding',
        vector_size: 2,
        chunking_signature_hash: signatureHash,
      });

      const incrementalSpy = vi
        .spyOn(tool as any, 'incrementalIndexRepo')
        .mockResolvedValue(undefined);
      const writeStateSpy = vi
        .spyOn(tool as any, 'writeIndexState')
        .mockResolvedValue(undefined);

      const { output } = await tool.invoke(
        { query: 'search' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBeUndefined();
      expect(incrementalSpy).toHaveBeenCalledWith(
        'codebase_https_github_com_org_repo_2',
        {
          repoId: 'https://github.com/org/repo',
          repoRoot: '/repo',
          repoSlug: 'https_github_com_org_repo',
          currentCommit: 'newcommit',
        },
        'oldcommit',
        2,
        'test-embedding',
        expect.any(Object),
        mockConfig,
        mockCfg,
      );
      expect(writeStateSpy).toHaveBeenCalled();
    });
  });

  describe('ignore rules', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should honor .codebaseindexignore patterns', async () => {
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'dist/\n# comment\n\n**/*.min.js\n!src/app.min.js\n',
        stderr: '',
        execPath: '',
      });

      const matcher = await (tool as any).loadIgnoreMatcher(
        '/repo',
        mockConfig,
        mockCfg,
      );

      expect(matcher.ignores('dist/app.js')).toBe(true);
      expect(matcher.ignores('src/app.min.js')).toBe(false);
      expect(matcher.ignores('src/other.min.js')).toBe(true);
      expect(matcher.ignores('src/app.ts')).toBe(false);
    });

    it('should cache ignore matcher per repo root', async () => {
      const execSpy = vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      await (tool as any).loadIgnoreMatcher('/repo', mockConfig, mockCfg);
      await (tool as any).loadIgnoreMatcher('/repo', mockConfig, mockCfg);

      expect(execSpy).toHaveBeenCalledTimes(1);
    });
  });
});
