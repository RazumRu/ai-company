import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesReadTool,
  FilesReadToolSchema,
  FilesReadToolSchemaType,
} from './files-read.tool';

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
      expect(tool.description).toContain('Read the contents of multiple files');
      expect(tool.description).toContain('line ranges');
    });
  });

  describe('schema', () => {
    it('should validate required filePaths field', () => {
      const validData = {
        filePaths: ['/path/to/repo/src/file.ts'],
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should reject missing filePaths field', () => {
      const invalidData = {};
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty filePaths array', () => {
      const invalidData = {
        filePaths: [],
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional startLine and endLine fields', () => {
      const validData = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 1,
        endLine: 10,
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should accept data without startLine and endLine', () => {
      const validData = {
        filePaths: ['/path/to/repo/src/file.ts'],
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should reject non-positive startLine', () => {
      const invalidData = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 0,
        endLine: 10,
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive endLine', () => {
      const invalidData = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 1,
        endLine: 0,
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer startLine', () => {
      const invalidData = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 1.5,
        endLine: 10,
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer endLine', () => {
      const invalidData = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 1,
        endLine: 10.5,
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should read entire file successfully (single file)', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/src/file.ts'],
      };

      const fileContent = 'line 1\nline 2\nline 3\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...fileContent.split('\n'),
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.length).toBe(1);
      expect(result.files?.[0]?.filePath).toBe('/path/to/repo/src/file.ts');
      expect(result.files?.[0]?.content).toBe(fileContent);
      expect(result.files?.[0]?.lineCount).toBe(4); // includes trailing empty line after final \n
    });

    it('should read multiple files in one call', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/src/a.ts', '/path/to/repo/src/b.ts'],
      };

      const aContent = 'a1\na2\n';
      const bContent = 'b1\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...aContent.split('\n'),
          '__AI_FILES_READ_END_test__0',
          '__AI_FILES_READ_BEGIN_test__1',
          '__AI_FILES_READ_EXIT_test__1:0',
          '__AI_FILES_READ_PAYLOAD_test__1',
          ...bContent.split('\n'),
          '__AI_FILES_READ_END_test__1',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.map((f) => f.filePath)).toEqual([
        '/path/to/repo/src/a.ts',
        '/path/to/repo/src/b.ts',
      ]);
      expect(result.files?.[0]?.content).toBe(aContent);
      expect(result.files?.[1]?.content).toBe(bContent);
    });

    it('should return per-file error when a file read fails', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/nonexistent.ts'],
      };

      const errMsg =
        'cat: /path/to/repo/nonexistent.ts: No such file or directory';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:1',
          '__AI_FILES_READ_PAYLOAD_test__0',
          errMsg,
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.filePath).toBe('/path/to/repo/nonexistent.ts');
      expect(result.files?.[0]?.error).toBe(errMsg);
    });

    it('should return error when endLine is provided without startLine', async () => {
      const args = {
        filePaths: ['/path/to/repo/src/file.ts'],
        endLine: 10,
      } as FilesReadToolSchemaType;

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'startLine must be provided when endLine is specified',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when startLine is provided without endLine', async () => {
      const args = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 1,
      } as FilesReadToolSchemaType;

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'endLine must be provided when startLine is specified',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when startLine is greater than endLine', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/src/file.ts'],
        startLine: 10,
        endLine: 5,
      };

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'startLine must be less than or equal to endLine',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when command fails', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/nonexistent.ts'],
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'cat: /path/to/repo/nonexistent.ts: No such file or directory',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'cat: /path/to/repo/nonexistent.ts: No such file or directory',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/src/file.ts'],
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: Permission denied',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: Permission denied');
      expect(result.files).toBeUndefined();
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/src/file.ts'],
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to read files');
      expect(result.files).toBeUndefined();
    });

    it('should handle file path with spaces', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to repo/src/my file.ts'],
      };

      const fileContent = 'content\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...fileContent.split('\n'),
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.content).toBe(fileContent);
    });

    it('should handle empty file', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/empty.txt'],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__AI_FILES_READ_PAYLOAD_test__0',
          '',
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.content).toBe('');
      expect(result.files?.[0]?.lineCount).toBe(1);
    });

    it('should handle file with only newline', async () => {
      const args: FilesReadToolSchemaType = {
        filePaths: ['/path/to/repo/newline.txt'],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__AI_FILES_READ_PAYLOAD_test__0',
          '',
          '',
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.content).toBe('\n');
      expect(result.files?.[0]?.lineCount).toBe(2);
    });
  });
});
