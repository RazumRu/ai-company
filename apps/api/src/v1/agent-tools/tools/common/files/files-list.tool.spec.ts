import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesListTool, FilesListToolSchemaType } from './files-list.tool';

describe('FilesListTool', () => {
  let tool: FilesListTool;
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
      providers: [FilesListTool],
    }).compile();

    tool = module.get<FilesListTool>(FilesListTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_list');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain(
        'List files in a repository directory',
      );
      expect(tool.description).toContain('fd');
    });
  });

  describe('schema', () => {
    it('should validate required dir field', () => {
      const validData = {
        dir: '/path/to/repo',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing dir field', () => {
      const invalidData = {};
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty dir', () => {
      const invalidData = {
        dir: '',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should accept optional pattern field', () => {
      const validData = {
        dir: '/path/to/repo',
        pattern: '*.ts',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept data without pattern', () => {
      const validData = {
        dir: '/path/to/repo',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept pattern with wildcards', () => {
      const validData = {
        dir: '/path/to/repo',
        pattern: 'src/**/*.ts',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should list files successfully without pattern', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'file1.ts\nfile2.ts\nfile3.js\n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual(['file1.ts', 'file2.ts', 'file3.js']);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && fd --absolute-path --type f --hidden --exclude .git',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should list files successfully with pattern', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
        pattern: '*.ts',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'file1.ts\nfile2.ts\n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual(['file1.ts', 'file2.ts']);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && fd --absolute-path --glob "*.ts" --type f --hidden --exclude .git',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle empty file list', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
        pattern: '*.nonexistent',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('should handle files with whitespace', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '  file1.ts  \n\n  file2.ts  \n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual(['file1.ts', 'file2.ts']);
      expect(result.error).toBeUndefined();
    });

    it('should return error when command fails', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'fd: command not found',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('fd: command not found');
      expect(result.files).toBeUndefined();
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: Directory not found',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: Directory not found');
      expect(result.files).toBeUndefined();
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to list files');
      expect(result.files).toBeUndefined();
    });

    it('should handle pattern with special characters', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to/repo',
        pattern: 'src/**/*.{ts,tsx}',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'src/file1.ts\nsrc/file2.tsx\n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual(['src/file1.ts', 'src/file2.tsx']);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && fd --absolute-path --glob "src/**/*.{ts,tsx}" --type f --hidden --exclude .git',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle dir with spaces', async () => {
      const args: FilesListToolSchemaType = {
        dir: '/path/to my repo',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: 'file1.ts\n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.files).toEqual(['file1.ts']);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to my repo" && fd --absolute-path --type f --hidden --exclude .git',
        },
        mockConfig,
        mockCfg,
      );
    });
  });
});
