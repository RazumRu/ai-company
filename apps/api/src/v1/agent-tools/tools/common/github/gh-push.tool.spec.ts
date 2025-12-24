import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhPushTool, GhPushToolSchemaType } from './gh-push.tool';

describe('GhPushTool', () => {
  let tool: GhPushTool;
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
      providers: [GhPushTool],
    }).compile();

    tool = module.get<GhPushTool>(GhPushTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_push');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Push commits from a local git');
    });
  });

  describe('schema', () => {
    it('should validate with no fields (all optional)', () => {
      const validData = {};
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with path field', () => {
      const validData = {
        path: '/path/to/repo',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with remote field', () => {
      const validData = {
        remote: 'upstream',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with branch field', () => {
      const validData = {
        branch: 'main',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with all fields', () => {
      const validData = {
        path: '/path/to/repo',
        remote: 'origin',
        branch: 'feature-branch',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should push successfully with default remote and current branch', async () => {
      const args: GhPushToolSchemaType = {};

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledTimes(1);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "origin"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should push successfully with custom remote', async () => {
      const args: GhPushToolSchemaType = {
        remote: 'upstream',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "upstream"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should push successfully with custom branch', async () => {
      const args: GhPushToolSchemaType = {
        branch: 'feature-branch',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "origin" "feature-branch"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should push successfully with custom remote and branch', async () => {
      const args: GhPushToolSchemaType = {
        remote: 'upstream',
        branch: 'main',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "upstream" "main"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should push successfully with path parameter', async () => {
      const args: GhPushToolSchemaType = {
        path: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'cd "/path/to/repo" && git push "origin"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should push successfully with all parameters', async () => {
      const args: GhPushToolSchemaType = {
        path: '/path/to/repo',
        remote: 'upstream',
        branch: 'feature-branch',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && git push "upstream" "feature-branch"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle push failure', async () => {
      const args: GhPushToolSchemaType = {};

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: failed to push some refs',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: failed to push some refs');
    });

    it('should handle push failure with stdout error', async () => {
      const args: GhPushToolSchemaType = {};

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: remote rejected',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: remote rejected');
    });

    it('should handle push failure with no error message', async () => {
      const args: GhPushToolSchemaType = {};

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to push commits');
    });

    it('should handle branch name with special characters', async () => {
      const args: GhPushToolSchemaType = {
        branch: 'feature/my-branch',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "origin" "feature/my-branch"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle remote name with special characters', async () => {
      const args: GhPushToolSchemaType = {
        remote: 'my-remote',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "my-remote"' },
        mockConfig,
        mockCfg,
      );
    });

    it('should work without path parameter', async () => {
      const args: GhPushToolSchemaType = {
        remote: 'origin',
        branch: 'main',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        { cmd: 'git push "origin" "main"' },
        mockConfig,
        mockCfg,
      );
    });
  });
});
