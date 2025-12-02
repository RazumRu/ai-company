import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhBranchTool, GhBranchToolSchemaType } from './gh-branch.tool';
import { SemanticCommitType } from './gh-commit.tool';

describe('GhBranchTool', () => {
  let tool: GhBranchTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: GhBaseToolConfig;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

    mockConfig = {
      runtime: mockRuntime,
      patToken: 'ghp_test_token',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GhBranchTool],
    }).compile();

    tool = module.get<GhBranchTool>(GhBranchTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_branch');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Create a new git branch');
    });
  });

  describe('schema', () => {
    it('should validate required semanticType and title fields', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing semanticType field', () => {
      const invalidData = { title: 'Add new feature' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing title field', () => {
      const invalidData = { semanticType: SemanticCommitType.FEAT };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty title', () => {
      const invalidData = {
        semanticType: SemanticCommitType.FEAT,
        title: '',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should use default base branch when not provided', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };
      const parsed = tool.schema.parse(validData);
      expect(parsed.base).toBeUndefined();
      // Default is handled in code, not in schema
    });

    it('should accept custom base branch', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        base: 'develop',
      };
      const parsed = tool.schema.parse(validData);
      expect(parsed.base).toBe('develop');
    });

    it('should validate all semantic commit types', () => {
      const types = Object.values(SemanticCommitType);
      types.forEach((type) => {
        const validData = {
          semanticType: type,
          title: 'Test branch',
        };
        expect(() => tool.schema.parse(validData)).not.toThrow();
      });
    });

    it('should validate optional path field', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should work without path field', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };
      const parsed = tool.schema.parse(validData);
      expect(parsed.path).toBeUndefined();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should create branch successfully with default base', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.branchName).toBe('feat/add-new-feature');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledTimes(2);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'git checkout main' },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        2,
        { cmd: 'git checkout -b "feat/add-new-feature"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should create branch successfully with custom base', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FIX,
        title: 'Fix bug',
        base: 'develop',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.branchName).toBe('fix/fix-bug');
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'git checkout develop' },
        mockConfig,
        mockCfg,
      );
    });

    it('should format branch name correctly', async () => {
      const testCases = [
        {
          semanticType: SemanticCommitType.FEAT,
          title: 'Add New Feature',
          expected: 'feat/add-new-feature',
        },
        {
          semanticType: SemanticCommitType.FIX,
          title: 'Fix Bug in Auth',
          expected: 'fix/fix-bug-in-auth',
        },
        {
          semanticType: SemanticCommitType.DOCS,
          title: 'Update README.md',
          expected: 'docs/update-readmemd',
        },
        {
          semanticType: SemanticCommitType.REFACTOR,
          title: 'Refactor User Service',
          expected: 'refactor/refactor-user-service',
        },
        {
          semanticType: SemanticCommitType.TEST,
          title: 'Test: Unit Tests',
          expected: 'test/test-unit-tests',
        },
        {
          semanticType: SemanticCommitType.CHORE,
          title: 'Multiple   Spaces',
          expected: 'chore/multiple-spaces',
        },
        {
          semanticType: SemanticCommitType.BUILD,
          title: 'Special@Chars#Here',
          expected: 'build/specialcharshere',
        },
        {
          semanticType: SemanticCommitType.CI,
          title: '---Leading---',
          expected: 'ci/leading',
        },
        {
          semanticType: SemanticCommitType.PERF,
          title: 'Trailing---',
          expected: 'perf/trailing',
        },
      ];

      for (const testCase of testCases) {
        const args: GhBranchToolSchemaType = {
          semanticType: testCase.semanticType,
          title: testCase.title,
        };

        vi.spyOn(tool as any, 'execGhCommand')
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          })
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          });

        const result = await tool.invoke(args, mockConfig, mockCfg);

        expect(result.branchName).toBe(testCase.expected);
        vi.clearAllMocks();
      }
    });

    it('should handle base branch checkout failure', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        base: 'nonexistent',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr:
          "error: pathspec 'nonexistent' did not match any file(s) known to git.",
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Failed to checkout base branch 'nonexistent'",
      );
      expect(result.branchName).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle branch creation failure', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr:
            "fatal: A branch named 'feat/add-new-feature' already exists.",
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "A branch named 'feat/add-new-feature' already exists",
      );
      expect(result.branchName).toBeUndefined();
    });

    it('should handle branch creation failure with stdout error', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: 'Error: Branch already exists',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Branch already exists');
    });

    it('should handle branch creation failure with no error message', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create branch');
    });

    it('should format commit message correctly for all semantic types', async () => {
      const types = [
        SemanticCommitType.FEAT,
        SemanticCommitType.FIX,
        SemanticCommitType.DOCS,
        SemanticCommitType.STYLE,
        SemanticCommitType.REFACTOR,
        SemanticCommitType.PERF,
        SemanticCommitType.TEST,
        SemanticCommitType.CHORE,
        SemanticCommitType.BUILD,
        SemanticCommitType.CI,
        SemanticCommitType.REVERT,
      ];

      for (const type of types) {
        const args: GhBranchToolSchemaType = {
          semanticType: type,
          title: 'Test branch',
        };

        vi.spyOn(tool as any, 'execGhCommand')
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          })
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          });

        await tool.invoke(args, mockConfig, mockCfg);

        expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
          2,
          {
            cmd: `git checkout -b "${type}/test-branch"`,
          },
          mockConfig,
          mockCfg,
        );

        vi.clearAllMocks();
      }
    });

    it('should use path parameter when provided', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'cd "/path/to/repo" && git checkout main' },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to/repo" && git checkout -b "feat/add-new-feature"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should work without path parameter', async () => {
      const args: GhBranchToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'git checkout main' },
        mockConfig,
        mockCfg,
      );
    });
  });
});
