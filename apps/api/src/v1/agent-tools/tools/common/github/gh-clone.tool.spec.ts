import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhCloneTool, GhCloneToolSchemaType } from './gh-clone.tool';

describe('GhCloneTool', () => {
  let tool: GhCloneTool;
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
      providers: [GhCloneTool],
    }).compile();

    tool = module.get<GhCloneTool>(GhCloneTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('gh_clone');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Clone a GitHub repository');
    });
  });

  describe('schema', () => {
    it('should validate required owner and repo fields', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing owner field', () => {
      const invalidData = { repo: 'Hello-World' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing repo field', () => {
      const invalidData = { owner: 'octocat' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty owner', () => {
      const invalidData = { owner: '', repo: 'Hello-World' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty repo', () => {
      const invalidData = { owner: 'octocat', repo: '' };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate optional branch field', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'main',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate optional depth field', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        depth: 1,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate branch and depth together', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'main',
        depth: 1,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should accept null branch', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        branch: null,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should accept null depth', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        depth: null,
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject negative depth', () => {
      const invalidData = {
        owner: 'octocat',
        repo: 'Hello-World',
        depth: -1,
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate optional workdir field', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: '/custom/path/Hello-World',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should accept null workdir', () => {
      const validData = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: null,
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

    it('should clone repository successfully', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository with branch', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'main',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World -- --branch main',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository with depth', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        depth: 1,
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World -- --depth 1',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository with branch and depth', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        branch: 'main',
        depth: 1,
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World -- --branch main --depth 1',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle clone failure', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Repository not found',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBeUndefined();
      expect(result.error).toBe('Repository not found');
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle clone failure with stdout error', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: Repository not found',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBeUndefined();
      expect(result.error).toBe('Error: Repository not found');
    });

    it('should handle clone failure with no error message', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBeUndefined();
      expect(result.error).toBe('Failed to clone repository');
    });

    it('should handle empty execPath', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe('Hello-World');
      expect(result.error).toBeUndefined();
    });

    it('should handle null branch', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle null depth', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe(
        '/runtime-workspace/test-thread-123/Hello-World',
      );
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository to custom workdir', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: '/custom/path/my-project',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe('/custom/path/my-project');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World /custom/path/my-project',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository to custom workdir with branch', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: '/custom/path/my-project',
        branch: 'develop',
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe('/custom/path/my-project');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World /custom/path/my-project -- --branch develop',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository to custom workdir with depth', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: '/custom/path/my-project',
        depth: 1,
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe('/custom/path/my-project');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World /custom/path/my-project -- --depth 1',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should clone repository to custom workdir with branch and depth', async () => {
      const args: GhCloneToolSchemaType = {
        owner: 'octocat',
        repo: 'Hello-World',
        workdir: '/custom/path/my-project',
        branch: 'main',
        depth: 1,
      };

      vi.spyOn(tool as any, 'execGhCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.path).toBe('/custom/path/my-project');
      expect(result.error).toBeUndefined();
      expect((tool as any).execGhCommand).toHaveBeenCalledWith(
        {
          cmd: 'gh repo clone octocat/Hello-World /custom/path/my-project -- --branch main --depth 1',
        },
        mockConfig,
        mockCfg,
      );
    });
  });
});
