import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../../environments';
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
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as any,
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
      expect(tool.description).toContain('Read one or more files');
      expect(tool.description).toContain('line numbers');
    });
  });

  describe('schema', () => {
    it('should validate required filesToRead field', () => {
      const validData = {
        filesToRead: [{ filePath: '/path/to/repo/src/file.ts' }],
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should reject missing filesToRead field', () => {
      const invalidData = {};
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty filesToRead array', () => {
      const invalidData = {
        filesToRead: [],
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional fromLineNumber and toLineNumber fields', () => {
      const validData = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 1,
            toLineNumber: 10,
          },
        ],
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should accept data without fromLineNumber and toLineNumber', () => {
      const validData = {
        filesToRead: [{ filePath: '/path/to/repo/src/file.ts' }],
      };
      expect(() => FilesReadToolSchema.parse(validData)).not.toThrow();
    });

    it('should reject non-positive fromLineNumber', () => {
      const invalidData = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 0,
            toLineNumber: 10,
          },
        ],
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive toLineNumber', () => {
      const invalidData = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 1,
            toLineNumber: 0,
          },
        ],
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer fromLineNumber', () => {
      const invalidData = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 1.5,
            toLineNumber: 10,
          },
        ],
      };
      expect(() => FilesReadToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer toLineNumber', () => {
      const invalidData = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 1,
            toLineNumber: 10.5,
          },
        ],
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
        filesToRead: [{ filePath: '/path/to/repo/src/file.ts' }],
      };

      const fileContent = 'line 1\nline 2\nline 3\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:20',
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
      // Content now has line numbers in NNN\t format
      expect(result.files?.[0]?.content).toContain('1\tline 1');
      expect(result.files?.[0]?.content).toContain('2\tline 2');
      expect(result.files?.[0]?.content).toContain('3\tline 3');
      expect(result.files?.[0]?.lineCount).toBe(4); // includes trailing empty line after final \n
      expect(result.files?.[0]?.startLine).toBe(1);
    });

    it('should read multiple files in one call', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [
          { filePath: '/path/to/repo/src/a.ts' },
          { filePath: '/path/to/repo/src/b.ts' },
        ],
      };

      const aContent = 'a1\na2\n';
      const bContent = 'b1\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:5',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...aContent.split('\n'),
          '__AI_FILES_READ_END_test__0',
          '__AI_FILES_READ_BEGIN_test__1',
          '__AI_FILES_READ_EXIT_test__1:0',
          '__SIZE__:3',
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
      // Content now has line numbers
      expect(result.files?.[0]?.content).toContain('1\ta1');
      expect(result.files?.[0]?.content).toContain('2\ta2');
      expect(result.files?.[1]?.content).toContain('1\tb1');
    });

    it('should return per-file error when a file read fails', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/nonexistent.ts' }],
      };

      const errMsg =
        'cat: /path/to/repo/nonexistent.ts: No such file or directory';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:1',
          '__SIZE__:0',
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
        filesToRead: [
          { filePath: '/path/to/repo/src/file.ts', toLineNumber: 10 },
        ],
      } as FilesReadToolSchemaType;

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'fromLineNumber must be provided when toLineNumber is specified (file: /path/to/repo/src/file.ts)',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when startLine is provided without endLine', async () => {
      const args = {
        filesToRead: [
          { filePath: '/path/to/repo/src/file.ts', fromLineNumber: 1 },
        ],
      } as FilesReadToolSchemaType;

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'toLineNumber must be provided when fromLineNumber is specified (file: /path/to/repo/src/file.ts)',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when startLine is greater than endLine', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/file.ts',
            fromLineNumber: 10,
            toLineNumber: 5,
          },
        ],
      };

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe(
        'fromLineNumber must be less than or equal to toLineNumber (file: /path/to/repo/src/file.ts)',
      );
      expect(result.files).toBeUndefined();
    });

    it('should return error when command fails', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/nonexistent.ts' }],
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
        filesToRead: [{ filePath: '/path/to/repo/src/file.ts' }],
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
        filesToRead: [{ filePath: '/path/to/repo/src/file.ts' }],
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
        filesToRead: [{ filePath: '/path/to repo/src/my file.ts' }],
      };

      const fileContent = 'content\n';

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:8',
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
      expect(result.files?.[0]?.content).toContain('1\tcontent');
    });

    it('should handle empty file', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/empty.txt' }],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:0',
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
      // Empty file gets line number for its single empty line
      expect(result.files?.[0]?.content).toBe('1\t');
      expect(result.files?.[0]?.lineCount).toBe(1);
    });

    it('should handle file with only newline', async () => {
      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/newline.txt' }],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:1',
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
      // File with single newline gets two numbered lines
      expect(result.files?.[0]?.content).toBe('1\t\n2\t');
      expect(result.files?.[0]?.lineCount).toBe(2);
    });

    it('should truncate files exceeding filesReadMaxLines when no line range specified', async () => {
      const maxLines = 100;
      vi.spyOn(environment as any, 'filesReadMaxLines', 'get').mockReturnValue(
        maxLines,
      );

      const totalLines = 200;
      const fileLines = Array.from(
        { length: totalLines },
        (_, i) => `line content ${i + 1}`,
      );

      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/src/large.ts' }],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:5000',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...fileLines,
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.length).toBe(1);

      const file = result.files?.[0];
      expect(file).toBeDefined();

      // lineCount should reflect the actual total
      expect(file!.lineCount).toBe(totalLines);

      // Should have warning
      expect(file!.warning).toContain('truncated');

      // Should contain truncation marker in content
      expect(file!.content).toContain('[TRUNCATED:');

      // First line should be present
      expect(file!.content).toContain('1\tline content 1');
      // Last line should be present
      expect(file!.content).toContain(
        `${totalLines}\tline content ${totalLines}`,
      );

      // A middle line should NOT be present (it was truncated)
      expect(file!.content).not.toContain('80\tline content 80');
    });

    it('should not truncate files within filesReadMaxLines limit', async () => {
      const fileLines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);

      const args: FilesReadToolSchemaType = {
        filesToRead: [{ filePath: '/path/to/repo/src/small.ts' }],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:500',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...fileLines,
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.warning).toBeUndefined();
      expect(result.files?.[0]?.content).not.toContain('[TRUNCATED:');
      expect(result.files?.[0]?.lineCount).toBe(50);
    });

    it('should not truncate when line ranges are specified even for large files', async () => {
      const maxLines = 100;
      vi.spyOn(environment as any, 'filesReadMaxLines', 'get').mockReturnValue(
        maxLines,
      );

      const fileLines = Array.from({ length: 50 }, (_, i) => `line ${i + 10}`);

      const args: FilesReadToolSchemaType = {
        filesToRead: [
          {
            filePath: '/path/to/repo/src/large.ts',
            fromLineNumber: 10,
            toLineNumber: 59,
          },
        ],
      };

      vi.spyOn(tool as any, 'createMarker').mockReturnValue('test');
      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: [
          '__AI_FILES_READ_BEGIN_test__0',
          '__AI_FILES_READ_EXIT_test__0:0',
          '__SIZE__:5000',
          '__AI_FILES_READ_PAYLOAD_test__0',
          ...fileLines,
          '__AI_FILES_READ_END_test__0',
          '',
        ].join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBeUndefined();
      expect(result.files?.[0]?.warning).toBeUndefined();
      expect(result.files?.[0]?.content).not.toContain('[TRUNCATED:');
      expect(result.files?.[0]?.startLine).toBe(10);
    });
  });
});
