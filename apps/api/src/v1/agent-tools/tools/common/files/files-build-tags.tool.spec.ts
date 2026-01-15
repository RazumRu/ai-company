import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesBuildTagsTool,
  FilesBuildTagsToolSchema,
  FilesBuildTagsToolSchemaType,
} from './files-build-tags.tool';

describe('FilesBuildTagsTool', () => {
  let tool: FilesBuildTagsTool;
  let mockRuntime: BaseRuntime;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockRuntime = {
      exec: vi.fn(),
      stop: vi.fn(),
      start: vi.fn(),
    } as unknown as BaseRuntime;

    mockConfig = {
      runtime: mockRuntime,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesBuildTagsTool],
    }).compile();

    tool = module.get<FilesBuildTagsTool>(FilesBuildTagsTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_build_tags');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Build a ctags index');
    });
  });

  describe('schema', () => {
    it('should validate required directoryPath and alias fields', () => {
      const validData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };
      expect(() => FilesBuildTagsToolSchema.parse(validData)).not.toThrow();
    });

    it('should allow missing directoryPath field (defaults to session cwd)', () => {
      const data = {
        alias: 'myrepo',
      };
      expect(() => FilesBuildTagsToolSchema.parse(data)).not.toThrow();
    });

    it('should reject missing alias field', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
      };
      expect(() => FilesBuildTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty directoryPath', () => {
      const invalidData = {
        directoryPath: '',
        alias: 'myrepo',
      };
      expect(() => FilesBuildTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty alias', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
        alias: '',
      };
      expect(() => FilesBuildTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should accept alias with special characters', () => {
      const validData = {
        directoryPath: '/path/to/repo',
        alias: 'my-repo_123',
      };
      expect(() => FilesBuildTagsToolSchema.parse(validData)).not.toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should build tags successfully', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      // Mock mkdir command
      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        // Mock ctags command
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.tagsFile).toBe('/tmp/test-thread-123/myrepo.json');
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledTimes(2);
      expect((tool as any).execCommand).toHaveBeenNthCalledWith(
        1,
        {
          cmd: 'mkdir -p "/tmp/test-thread-123"',
        },
        mockConfig,
        mockCfg,
      );
      expect((tool as any).execCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to/repo" && ctags -R --fields=+n+K --extras=+q --output-format=json -f "/tmp/test-thread-123/myrepo.json" .',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should use parent_thread_id when available', async () => {
      const mockCfgWithParent: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {
          thread_id: 'test-thread-123',
          parent_thread_id: 'parent-thread-456',
        },
      };

      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/parent-thread-456',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/parent-thread-456',
        });

      const { output: result } = await tool.invoke(
        args,
        mockConfig,
        mockCfgWithParent,
      );

      expect(result.success).toBe(true);
      expect(result.tagsFile).toBe('/tmp/parent-thread-456/myrepo.json');
      expect((tool as any).execCommand).toHaveBeenNthCalledWith(
        1,
        {
          cmd: 'mkdir -p "/tmp/parent-thread-456"',
        },
        mockConfig,
        mockCfgWithParent,
      );
    });

    it('should use fallback thread_id when parent_thread_id is not available', async () => {
      const mockCfgFallback: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {
          thread_id: 'test-thread-789',
        },
      };

      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-789',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-789',
        });

      const { output: result } = await tool.invoke(
        args,
        mockConfig,
        mockCfgFallback,
      );

      expect(result.success).toBe(true);
      expect(result.tagsFile).toBe('/tmp/test-thread-789/myrepo.json');
    });

    it('should return error when no thread_id is available', async () => {
      const mockCfgNoThread: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {},
      };

      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      const execSpy = vi.spyOn(tool as any, 'execCommand');

      const { output: result } = await tool.invoke(
        args,
        mockConfig,
        mockCfgNoThread,
      );

      expect(result.error).toBe('Thread id is required to build tags');
      expect(execSpy).not.toHaveBeenCalled();
    });

    it('should return error when mkdir fails', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'mkdir: Permission denied',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'Failed to create tags directory: mkdir: Permission denied',
      );
      expect(result.success).toBeUndefined();
      expect(result.tagsFile).toBeUndefined();
    });

    it('should return error when mkdir fails with stdout message', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'Error: Cannot create directory',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'Failed to create tags directory: Error: Cannot create directory',
      );
      expect(result.success).toBeUndefined();
    });

    it('should return error when ctags command fails', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'ctags: command not found',
          execPath: '',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('ctags: command not found');
      expect(result.success).toBeUndefined();
      expect(result.tagsFile).toBeUndefined();
    });

    it('should return error when ctags fails with stdout message', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: 'Error: Invalid directory',
          stderr: '',
          execPath: '',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: Invalid directory');
      expect(result.success).toBeUndefined();
    });

    it('should return default error message when ctags fails with empty output', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
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
          execPath: '',
        });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to build tags');
      expect(result.success).toBeUndefined();
    });

    it('should handle directoryPath with spaces', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to my repo',
        alias: 'myrepo',
      };

      vi.spyOn(tool as any, 'execCommand')
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect((tool as any).execCommand).toHaveBeenNthCalledWith(
        2,
        {
          cmd: 'cd "/path/to my repo" && ctags -R --fields=+n+K --extras=+q --output-format=json -f "/tmp/test-thread-123/myrepo.json" .',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle alias with special characters', async () => {
      const args: FilesBuildTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'my-repo_123',
      };

      vi.spyOn(tool as any, 'execCommand')
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.tagsFile).toBe('/tmp/test-thread-123/my-repo_123.json');
    });
  });
});
