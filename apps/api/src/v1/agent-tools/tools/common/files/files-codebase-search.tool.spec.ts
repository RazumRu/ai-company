import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RepoIndexStatus } from '../../../../git-repositories/git-repositories.types';
import { RepoIndexService } from '../../../../git-repositories/services/repo-index.service';
import type { GetOrInitIndexResult } from '../../../../git-repositories/services/repo-index.types';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';

describe('FilesCodebaseSearchTool', () => {
  let tool: FilesCodebaseSearchTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: FilesBaseToolConfig;
  let mockRepoIndexService: RepoIndexService;

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

    mockRepoIndexService = {
      getOrInitIndexForRepo: vi.fn().mockResolvedValue({
        status: 'ready',
        repoIndex: {
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult),
      searchCodebase: vi.fn().mockResolvedValue([]),
    } as unknown as RepoIndexService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesCodebaseSearchTool,
        { provide: RepoIndexService, useValue: mockRepoIndexService },
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
      expect(() =>
        tool.validate({ query: 'find auth', gitRepoDirectory: 'apps/api' }),
      ).not.toThrow();
    });

    it('should reject missing query field', () => {
      expect(() => tool.validate({})).toThrow();
    });

    it('should reject empty query field', () => {
      expect(() =>
        tool.validate({ query: '', gitRepoDirectory: 'apps/api' }),
      ).toThrow();
    });

    it('should reject missing gitRepoDirectory field', () => {
      expect(() => tool.validate({ query: 'find auth' })).toThrow();
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
        { query: 'search term', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain('requires a cloned git repository');
      expect(output.results).toBeUndefined();
    });

    it('should return filtered search results when index is ready', async () => {
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'git@github.com:org/repo.git',
          stderr: '',
          execPath: '',
        });

      (
        mockRepoIndexService.getOrInitIndexForRepo as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        status: 'ready',
        repoIndex: {
          id: 'index-1',
          repositoryId: 'repo-uuid',
          repoUrl: 'https://github.com/org/repo',
          status: RepoIndexStatus.Completed,
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([
        {
          path: 'apps/api/src/index.ts',
          start_line: 1,
          end_line: 10,
          text: 'const value = 1;',
          score: 0.9,
        },
      ]);

      const { output } = await tool.invoke(
        {
          query: 'index',
          gitRepoDirectory: 'apps/api',
          language: 'ts',
          top_k: 5,
        },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBeUndefined();
      expect(output.results).toHaveLength(1);
      expect(output.results?.[0]?.path).toBe('apps/api/src/index.ts');
      expect(mockRepoIndexService.searchCodebase).toHaveBeenCalledTimes(1);
      expect(mockRepoIndexService.searchCodebase).toHaveBeenCalledWith({
        collection: 'codebase_test_repo_main_1536',
        query: 'index',
        repoId: 'https://github.com/org/repo',
        topK: 5,
        directoryFilter: expect.any(String),
        languageFilter: 'ts',
      });
      expect(mockRepoIndexService.getOrInitIndexForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId: expect.any(String),
          repoUrl: 'https://github.com/org/repo',
          repoRoot: '/repo',
        }),
      );
    });

    it('should return status message when indexing is in progress', async () => {
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'https://github.com/org/repo',
          stderr: '',
          execPath: '',
        });

      (
        mockRepoIndexService.getOrInitIndexForRepo as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        status: 'in_progress',
        repoIndex: {
          id: 'index-1',
          status: RepoIndexStatus.InProgress,
        },
      } as GetOrInitIndexResult);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBe(
        'Repository indexing is currently in progress. This is normal for the first search in a repository.',
      );
      expect(output.results).toEqual([]);
      expect(mockRepoIndexService.searchCodebase).not.toHaveBeenCalled();
    });

    it('should return status message when indexing is pending', async () => {
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'https://github.com/org/repo',
          stderr: '',
          execPath: '',
        });

      (
        mockRepoIndexService.getOrInitIndexForRepo as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        status: 'pending',
        repoIndex: {
          id: 'index-1',
          status: RepoIndexStatus.Pending,
        },
      } as GetOrInitIndexResult);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBe(
        'Repository indexing is currently in progress. This is normal for the first search in a repository.',
      );
      expect(output.results).toEqual([]);
      expect(mockRepoIndexService.searchCodebase).not.toHaveBeenCalled();
    });
  });
});
