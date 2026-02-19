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
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as any,
      patToken: 'ghp_test_token',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GhPushTool],
    }).compile();

    tool = module.get<GhPushTool>(GhPushTool);
  });

  /**
   * Helper to mock execGhCommand for a standard push flow.
   * The invoke method now calls:
   *   1. resolveBranch  (git symbolic-ref --short HEAD) — skipped when args.branch is set
   *   2. detectDefaultBranch (git symbolic-ref refs/remotes/<remote>/HEAD)
   *   3. git push (the actual push)
   *
   * Since resolveBranch & detectDefaultBranch run via Promise.all, their order in
   * mockResolvedValueOnce depends on the Promise scheduler but we use sequential
   * mocking — the spy records calls in order they arrive.
   */
  function mockBranchDetection(
    spy: ReturnType<typeof vi.spyOn>,
    opts: {
      currentBranch?: string;
      defaultBranch?: string;
      hasBranchArg?: boolean;
    },
  ) {
    // When args.branch is specified, resolveBranch returns immediately without
    // calling execGhCommand, so only detectDefaultBranch issues a command.
    if (!opts.hasBranchArg) {
      // resolveBranch call
      spy.mockResolvedValueOnce({
        exitCode: opts.currentBranch ? 0 : 1,
        stdout: opts.currentBranch ?? '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });
    }

    // detectDefaultBranch call
    spy.mockResolvedValueOnce({
      exitCode: opts.defaultBranch ? 0 : 1,
      stdout: opts.defaultBranch
        ? `refs/remotes/origin/${opts.defaultBranch}`
        : '',
      stderr: '',
      execPath: '/runtime-workspace/test-thread-123',
    });
  }

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_push');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain(
        'Push local commits to the remote GitHub repository',
      );
    });
  });

  describe('schema', () => {
    it('should reject missing path field', () => {
      const invalidData = {};
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate with path field only', () => {
      const validData = {
        path: '/path/to/repo',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with path and remote fields', () => {
      const validData = {
        path: '/path/to/repo',
        remote: 'upstream',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate with path and branch fields', () => {
      const validData = {
        path: '/path/to/repo',
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
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      // push call
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should push successfully with custom remote', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        remote: 'upstream',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should push successfully with custom branch', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        branch: 'feature-branch',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        hasBranchArg: true,
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should push successfully with all parameters', async () => {
      const args: GhPushToolSchemaType = {
        path: '/path/to/repo',
        remote: 'upstream',
        branch: 'feature-branch',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        hasBranchArg: true,
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });

    it('should handle push failure', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
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
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
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
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
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
        path: '/runtime-workspace/repo',
        branch: 'feature/my-branch',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        hasBranchArg: true,
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });

    it('should handle remote name with special characters', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        remote: 'my-remote',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'feat/my-feature',
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });

    it('should allow push when default branch detection fails', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'main',
        defaultBranch: undefined, // detection failed
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });

    it('should allow push when current branch detection fails', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: undefined, // detection failed
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });
  });

  describe('default branch protection', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should block push when current branch matches default branch (main)', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'main',
        defaultBranch: 'main',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Pushing to the default branch "main" is not allowed',
      );
      expect(result.error).toContain('gh_create_pull_request');
    });

    it('should block push when current branch matches default branch (master)', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'master',
        defaultBranch: 'master',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Pushing to the default branch "master" is not allowed',
      );
    });

    it('should block push when explicit branch arg matches default branch', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        branch: 'main',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        hasBranchArg: true,
        defaultBranch: 'main',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Pushing to the default branch "main" is not allowed',
      );
    });

    it('should allow push when branch differs from default branch', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        branch: 'feat/new-feature',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        hasBranchArg: true,
        defaultBranch: 'main',
      });
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
    });

    it('should not issue push command when blocking default branch', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      mockBranchDetection(spy, {
        currentBranch: 'main',
        defaultBranch: 'main',
      });

      await tool.invoke(args, mockConfig, mockCfg);

      // Only the branch detection calls, no push call
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('should block push with custom remote when branch matches default', async () => {
      const args: GhPushToolSchemaType = {
        path: '/runtime-workspace/repo',
        remote: 'upstream',
        branch: 'develop',
      };

      const spy = vi.spyOn(tool as any, 'execGhCommand');
      // detectDefaultBranch for upstream returns 'develop'
      spy.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'refs/remotes/upstream/develop',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'Pushing to the default branch "develop" is not allowed',
      );
    });
  });
});
