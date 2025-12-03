import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesReadTool, FilesReadToolSchemaType } from './files-read.tool';

describe('FilesReadTool', () => {
  let tool: FilesReadTool;
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
      providers: [FilesReadTool],
    }).compile();

    tool = module.get<FilesReadTool>(FilesReadTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_read');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Read the contents of a file');
      expect(tool.description).toContain('line ranges');
    });
  });

  describe('schema', () => {
    it('should validate required filePath field', () => {
      const validData = {
        filePath: '/path/to/repo/src/file.ts',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing filePath field', () => {
      const invalidData = {};
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty filePath', () => {
      const invalidData = {
        filePath: '',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should accept optional startLine and endLine fields', () => {
      const validData = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 1,
        endLine: 10,
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept data without startLine and endLine', () => {
      const validData = {
        filePath: '/path/to/repo/src/file.ts',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject non-positive startLine', () => {
      const invalidData = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 0,
        endLine: 10,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive endLine', () => {
      const invalidData = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 1,
        endLine: 0,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer startLine', () => {
      const invalidData = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 1.5,
        endLine: 10,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer endLine', () => {
      const invalidData = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 1,
        endLine: 10.5,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should read entire file successfully using cat', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
      };

      const fileContent = 'line 1\nline 2\nline 3\n';

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: fileContent,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe(fileContent);
      expect(result.lineCount).toBe(4); // 'line 1\nline 2\nline 3\n' splits to ['line 1', 'line 2', 'line 3', '']
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cat "/path/to/repo/src/file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should read specific line range using sed', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 2,
        endLine: 4,
      };

      const fileContent = 'line 2\nline 3\nline 4\n';

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: fileContent,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe(fileContent);
      expect(result.lineCount).toBe(4); // 'line 2\nline 3\nline 4\n' splits to ['line 2', 'line 3', 'line 4', '']
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'sed -n \'2,4p\' "/path/to/repo/src/file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should read single line using sed', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 5,
        endLine: 5,
      };

      const fileContent = 'line 5\n';

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: fileContent,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe(fileContent);
      expect(result.lineCount).toBe(2); // 'line 5\n' splits to ['line 5', '']
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'sed -n \'5,5p\' "/path/to/repo/src/file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should return error when endLine is provided without startLine', async () => {
      const args = {
        filePath: '/path/to/repo/src/file.ts',
        endLine: 10,
      } as FilesReadToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'startLine must be provided when endLine is specified',
      );
      expect(result.content).toBeUndefined();
    });

    it('should return error when startLine is provided without endLine', async () => {
      const args = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 1,
      } as FilesReadToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'endLine must be provided when startLine is specified',
      );
      expect(result.content).toBeUndefined();
    });

    it('should return error when startLine is greater than endLine', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
        startLine: 10,
        endLine: 5,
      };

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'startLine must be less than or equal to endLine',
      );
      expect(result.content).toBeUndefined();
    });

    it('should return error when command fails', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/nonexistent.ts',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'cat: /path/to/repo/nonexistent.ts: No such file or directory',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'cat: /path/to/repo/nonexistent.ts: No such file or directory',
      );
      expect(result.content).toBeUndefined();
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: Permission denied',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: Permission denied');
      expect(result.content).toBeUndefined();
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/src/file.ts',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to read file');
      expect(result.content).toBeUndefined();
    });

    it('should handle file path with spaces', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to repo/src/my file.ts',
      };

      const fileContent = 'content\n';

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: fileContent,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe(fileContent);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cat "/path/to repo/src/my file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle empty file', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/empty.txt',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe('');
      expect(result.lineCount).toBe(1); // Empty string splits to ['']
      expect(result.error).toBeUndefined();
    });

    it('should handle file with only newline', async () => {
      const args: FilesReadToolSchemaType = {
        filePath: '/path/to/repo/newline.txt',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '\n',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.content).toBe('\n');
      expect(result.lineCount).toBe(2);
      expect(result.error).toBeUndefined();
    });
  });
});
