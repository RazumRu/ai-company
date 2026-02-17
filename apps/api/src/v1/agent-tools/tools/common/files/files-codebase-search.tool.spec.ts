import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RepoIndexStatus } from '../../../../git-repositories/git-repositories.types';
import { RepoIndexService } from '../../../../git-repositories/services/repo-index.service';
import type { GetOrInitIndexResult } from '../../../../git-repositories/services/repo-index.types';
import { RepoIndexerService } from '../../../../git-repositories/services/repo-indexer.service';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';

describe('FilesCodebaseSearchTool', () => {
  let tool: FilesCodebaseSearchTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: FilesBaseToolConfig;
  let mockRepoIndexService: RepoIndexService;
  let mockRepoIndexerService: RepoIndexerService;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

    mockConfig = {
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as unknown as FilesBaseToolConfig['runtimeProvider'],
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

    mockRepoIndexerService = {
      deriveRepoId: vi.fn().mockImplementation((url: string) => {
        // Mimic real normalization: SSH → HTTPS, strip .git
        const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
        if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
        return url.replace(/\.git$/, '');
      }),
    } as unknown as RepoIndexerService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesCodebaseSearchTool,
        { provide: RepoIndexService, useValue: mockRepoIndexService },
        { provide: RepoIndexerService, useValue: mockRepoIndexerService },
      ],
    }).compile();

    tool = module.get<FilesCodebaseSearchTool>(FilesCodebaseSearchTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('codebase_search');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('semantic search');
      expect(tool.description).toContain('natural-language queries');
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

    it('should accept missing gitRepoDirectory field (optional — auto-discovered)', () => {
      expect(() => tool.validate({ query: 'find auth' })).not.toThrow();
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
        minScore: 0.3,
      });
      expect(mockRepoIndexService.getOrInitIndexForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId: expect.any(String),
          repoUrl: 'https://github.com/org/repo',
          repoRoot: '/repo',
          branch: 'main',
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          estimatedTokens: 0,
          indexedTokens: 0,
        },
      } as GetOrInitIndexResult);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain(
        'Repository indexing is currently in progress.',
      );
      expect(output.error).toContain('Do not call codebase_search again');
      expect(output.results).toEqual([]);
      expect(mockRepoIndexService.searchCodebase).not.toHaveBeenCalled();
    });

    it('should return partial results when indexing is pending and search finds matches', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
          estimatedTokens: 500000,
          indexedTokens: 250000,
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([
        {
          path: 'src/partial.ts',
          start_line: 1,
          end_line: 10,
          text: 'partial result',
          score: 0.8,
        },
      ]);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.partialResults).toBe(true);
      expect(output.results).toHaveLength(1);
      expect(output.results?.[0]?.path).toBe('src/partial.ts');
      expect(output.error).toBeUndefined();
      expect(output.message).toContain('PARTIAL results');
      expect(output.message).toContain('Progress: 50%');
      expect(mockRepoIndexService.searchCodebase).toHaveBeenCalledTimes(1);
    });

    it('should fall back to indexing message when pending search returns empty', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
          estimatedTokens: 500000,
          indexedTokens: 250000,
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([]);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain(
        'Repository indexing is currently in progress.',
      );
      expect(output.error).toContain('Progress: 50%');
      expect(output.error).toContain('Do not call codebase_search again');
      expect(output.results).toEqual([]);
      expect(output.partialResults).toBeUndefined();
      expect(mockRepoIndexService.searchCodebase).toHaveBeenCalledTimes(1);
    });

    it('should not attempt partial search when indexedTokens is 0', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          qdrantCollection: 'codebase_test_repo_main_1536',
          estimatedTokens: 500000,
          indexedTokens: 0,
        },
      } as GetOrInitIndexResult);

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain(
        'Repository indexing is currently in progress.',
      );
      expect(output.results).toEqual([]);
      expect(output.partialResults).toBeUndefined();
      expect(mockRepoIndexService.searchCodebase).not.toHaveBeenCalled();
    });

    it('should return auth error with fallback guidance when partial search hits authentication error', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
          estimatedTokens: 500000,
          indexedTokens: 100000,
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(
        new Error('litellm.AuthenticationError: missing api_key'),
      );

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain('authentication failed');
      expect(output.error).toContain('Do not retry codebase_search');
      expect(output.error).toContain('files_search_text');
      expect(output.results).toBeUndefined();
    });

    it('should fall back gracefully when partial search throws', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
          estimatedTokens: 500000,
          indexedTokens: 100000,
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error('Qdrant connection error'));

      const { output } = await tool.invoke(
        { query: 'search', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain(
        'Repository indexing is currently in progress.',
      );
      expect(output.error).toContain('Progress: 20%');
      expect(output.results).toEqual([]);
      expect(output.partialResults).toBeUndefined();
    });

    it('should return auth error with fallback guidance when ready search hits authentication error', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(
        new Error('AuthenticationError: Incorrect API key provided'),
      );

      const { output } = await tool.invoke(
        { query: 'find auth middleware', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain('authentication failed');
      expect(output.error).toContain('Do not retry codebase_search');
      expect(output.error).toContain('files_directory_tree');
      expect(output.error).toContain('files_find_paths');
      expect(output.error).toContain('files_search_text');
      expect(output.results).toBeUndefined();
    });

    it('should re-throw non-auth errors from ready search', async () => {
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error('Qdrant connection timeout'));

      await expect(
        tool.invoke(
          { query: 'find something', gitRepoDirectory: 'apps/api' },
          mockConfig,
          mockCfg,
        ),
      ).rejects.toThrow('Qdrant connection timeout');
    });
  });

  describe('normalizeDirectoryFilter', () => {
    // Access the private method via type assertion
    const normalize = (directory: string | undefined, repoRoot: string) =>
      (
        tool as unknown as {
          normalizeDirectoryFilter: (
            dir: string | undefined,
            root: string,
          ) => string | undefined;
        }
      ).normalizeDirectoryFilter(directory, repoRoot);

    it('returns undefined for undefined input', () => {
      expect(normalize(undefined, '/repo')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(normalize('', '/repo')).toBeUndefined();
    });

    it('returns undefined for whitespace-only string', () => {
      expect(normalize('   ', '/repo')).toBeUndefined();
    });

    it('normalizes a relative path to be relative to repo root', () => {
      const result = normalize('src/utils', '/repo');
      expect(result).toBe('src/utils');
    });

    it('normalizes an absolute path inside the repo to be relative', () => {
      const result = normalize('/repo/src/utils', '/repo');
      expect(result).toBe('src/utils');
    });

    it('returns empty string for the repo root itself', () => {
      expect(normalize('/repo', '/repo')).toBe('');
    });

    it('returns empty string for "." path', () => {
      expect(normalize('.', '/repo')).toBe('');
    });

    it('normalizes paths with trailing slashes', () => {
      const result = normalize('src/utils/', '/repo');
      // Should produce a clean path without trailing slash
      expect(result).toBe('src/utils');
    });

    it('normalizes paths with backslashes (Windows-style)', () => {
      const result = normalize('src\\utils\\helpers', '/repo');
      expect(result).toBe('src/utils/helpers');
    });

    it('normalizes paths with redundant separators', () => {
      const result = normalize('src//utils///helpers', '/repo');
      expect(result).toBe('src/utils/helpers');
    });

    it('strips leading slashes from normalized relative paths', () => {
      const result = normalize('/src/utils', '/repo');
      // /src/utils is absolute but resolve('/repo', '/src/utils') = '/src/utils'
      // relative('/repo', '/src/utils') = '../src/utils' (outside repo)
      // Falls through to the final return branch: posix normalize of '/src/utils' with leading slash stripped
      expect(result).not.toMatch(/^\//);
    });
  });

  describe('auto-discovery', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should auto-discover git repo when gitRepoDirectory is omitted', async () => {
      vi.spyOn(
        tool as unknown as { execCommand: (...args: unknown[]) => unknown },
        'execCommand',
      )
        // autoDiscoverRepo: find .git dirs
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/runtime-workspace/my-repo/.git\n',
          stderr: '',
          execPath: '',
        })
        // resolveRepoRoot: git rev-parse
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/runtime-workspace/my-repo',
          stderr: '',
          execPath: '',
        })
        // resolveRepoInfo: git remote get-url
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'https://github.com/org/repo',
          stderr: '',
          execPath: '',
        })
        // resolveCurrentBranch: symbolic-ref
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([]);

      const { output } = await tool.invoke(
        { query: 'find auth' },
        mockConfig,
        mockCfg,
      );

      // Should not produce an error — successfully auto-discovered the repo
      expect(output.error).toBeUndefined();
    });

    it('should return error when no git repo found and gitRepoDirectory omitted', async () => {
      vi.spyOn(
        tool as unknown as { execCommand: (...args: unknown[]) => unknown },
        'execCommand',
      )
        // autoDiscoverRepo: find .git dirs — none found
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '',
        });

      const { output } = await tool.invoke(
        { query: 'find auth' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toContain(
        'requires a cloned git repository but none was found',
      );
    });
  });

  describe('invoke edge cases', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should return error for whitespace-only query', async () => {
      vi.spyOn(
        tool as unknown as { execCommand: (...args: unknown[]) => unknown },
        'execCommand',
      )
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
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'main',
          stderr: '',
          execPath: '',
        });

      const { output } = await tool.invoke(
        { query: '   ', gitRepoDirectory: 'apps/api' },
        mockConfig,
        mockCfg,
      );

      expect(output.error).toBe('query must not be blank');
    });
  });

  describe('resolveCurrentBranch', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should fall back to master when main does not exist', async () => {
      vi.spyOn(
        tool as unknown as { execCommand: (...args: unknown[]) => unknown },
        'execCommand',
      )
        // resolveRepoRoot
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '/repo',
          stderr: '',
          execPath: '',
        })
        // resolveRepoInfo (remote URL)
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'https://github.com/org/repo',
          stderr: '',
          execPath: '',
        })
        // symbolic-ref --short HEAD (detached HEAD)
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'fatal: ref HEAD is not a symbolic ref',
          execPath: '',
        })
        // symbolic-ref refs/remotes/origin/HEAD (no remote HEAD)
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'fatal',
          execPath: '',
        })
        // git branch --list main master
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '  master\n',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_master_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([]);

      await tool.invoke(
        { query: 'find something', gitRepoDirectory: '/repo' },
        mockConfig,
        mockCfg,
      );

      expect(mockRepoIndexService.getOrInitIndexForRepo).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'master' }),
      );
    });

    it('should default to main when neither main nor master exists', async () => {
      vi.spyOn(
        tool as unknown as { execCommand: (...args: unknown[]) => unknown },
        'execCommand',
      )
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
        })
        // symbolic-ref --short HEAD (detached HEAD)
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: '',
          execPath: '',
        })
        // symbolic-ref refs/remotes/origin/HEAD
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: '',
          execPath: '',
        })
        // git branch --list main master (neither exists)
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
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
          repoUrl: 'https://github.com/org/repo',
          qdrantCollection: 'codebase_test_repo_main_1536',
        },
      } as GetOrInitIndexResult);

      (
        mockRepoIndexService.searchCodebase as unknown as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([]);

      await tool.invoke(
        { query: 'find something', gitRepoDirectory: '/repo' },
        mockConfig,
        mockCfg,
      );

      expect(mockRepoIndexService.getOrInitIndexForRepo).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'main' }),
      );
    });
  });
});
