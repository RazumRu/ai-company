import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { GhBaseToolConfig } from './gh-base.tool';
import {
  GhCommitTool,
  GhCommitToolSchemaType,
  SemanticCommitType,
} from './gh-commit.tool';

describe('GhCommitTool', () => {
  let tool: GhCommitTool;
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
      providers: [GhCommitTool],
    }).compile();

    tool = module.get<GhCommitTool>(GhCommitTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_commit');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Create a git (GitHub) commit');
    });
  });

  describe('schema', () => {
    it('should validate required semanticType, title, and path fields', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing semanticType field', () => {
      const invalidData = {
        title: 'Add new feature',
        path: '/path/to/repo',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing title field', () => {
      const invalidData = {
        semanticType: SemanticCommitType.FEAT,
        path: '/path/to/repo',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty title', () => {
      const invalidData = {
        semanticType: SemanticCommitType.FEAT,
        title: '',
        path: '/path/to/repo',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate optional body field', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
        body: 'This is a detailed description',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate all semantic commit types', () => {
      const types = Object.values(SemanticCommitType);
      types.forEach((type) => {
        const validData = {
          semanticType: type,
          title: 'Test commit',
          path: '/path/to/repo',
        };
        expect(() => tool.validate(validData)).not.toThrow();
      });
    });

    it('should validate required path field', () => {
      const validData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing path field', () => {
      const invalidData = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should create commit successfully with title only', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'abc123def456',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('abc123def456');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledTimes(3);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'cd "/path/to/repo" && git diff --cached --quiet' },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to/repo" && git commit -m "feat: [AI] Add new feature"',
        },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        3,
        { cmd: 'cd "/path/to/repo" && git rev-parse HEAD' },
        mockConfig,
        mockCfg,
      );
    });

    it('should create commit successfully with title and body', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FIX,
        title: 'Fix bug in authentication',
        body: 'This fixes a critical bug where users could not authenticate.',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'def456ghi789',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBe('def456ghi789');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to/repo" && git commit -m "fix: [AI] Fix bug in authentication" -m "This fixes a critical bug where users could not authenticate."',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle no staged changes', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0, // No staged changes
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No staged changes to commit');
      expect(result.commitHash).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledTimes(1);
    });

    it('should handle commit failure', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Error: nothing to commit',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: nothing to commit');
      expect(result.commitHash).toBeUndefined();
    });

    it('should handle commit failure with stdout error', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: 'Error: nothing to commit',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: nothing to commit');
    });

    it('should handle commit failure with no error message', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create commit');
    });

    it('should handle missing commit hash gracefully', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1, // Failed to get hash
          stdout: '',
          stderr: 'Not a git repository',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.commitHash).toBeUndefined();
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
        const args: GhCommitToolSchemaType = {
          semanticType: type,
          title: 'Test commit',
          path: '/path/to/repo',
        };

        vi.spyOn(tool as any, 'execGhCommand')
          .mockResolvedValueOnce({
            exitCode: 1, // Has staged changes
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          })
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: '',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          })
          .mockResolvedValueOnce({
            exitCode: 0,
            stdout: 'abc123',
            stderr: '',
            execPath: '/runtime-workspace/test-thread-123',
          });

        await tool.invoke(args, mockConfig, mockCfg);

        expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
          2,
          {
            cmd: `cd "/path/to/repo" && git commit -m "${type}: [AI] Test commit"`,
          },
          mockConfig,
          mockCfg,
        );

        vi.clearAllMocks();
      }
    });

    it('should use path parameter when provided', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'abc123def456',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'cd "/path/to/repo" && git diff --cached --quiet' },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to/repo" && git commit -m "feat: [AI] Add new feature"',
        },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        3,
        { cmd: 'cd "/path/to/repo" && git rev-parse HEAD' },
        mockConfig,
        mockCfg,
      );
    });

    it('should work with path parameter', async () => {
      const args: GhCommitToolSchemaType = {
        semanticType: SemanticCommitType.FEAT,
        title: 'Add new feature',
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand')
        .mockResolvedValueOnce({
          exitCode: 1, // Has staged changes
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'abc123def456',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenNthCalledWith(
        1,
        { cmd: 'cd "/path/to/repo" && git diff --cached --quiet' },
        mockConfig,
        mockCfg,
      );
    });
  });
});
