import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import {
  FilesApplyChangesTool,
  FilesApplyChangesToolSchemaType,
} from './files-apply-changes.tool';
import { FilesBaseToolConfig } from './files-base.tool';

describe('FilesApplyChangesTool', () => {
  let tool: FilesApplyChangesTool;
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
      providers: [FilesApplyChangesTool],
    }).compile();

    tool = module.get<FilesApplyChangesTool>(FilesApplyChangesTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_apply_changes');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Apply changes to a file');
      expect(tool.description).toContain('replacing entire file');
    });
  });

  describe('schema', () => {
    it('should validate required filePath and operation fields', () => {
      const validData = {
        filePath: '/path/to/file.ts',
        operation: 'replace' as const,
        content: 'new content',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing filePath field', () => {
      const invalidData = {
        operation: 'replace' as const,
        content: 'new content',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing operation field', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        content: 'new content',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty filePath', () => {
      const invalidData = {
        filePath: '',
        operation: 'replace' as const,
        content: 'new content',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should accept valid operation values', () => {
      const operations = [
        'replace',
        'replace_range',
        'insert',
        'delete',
      ] as const;
      for (const op of operations) {
        const validData = {
          filePath: '/path/to/file.ts',
          operation: op,
          content: op !== 'delete' ? 'content' : undefined,
          startLine: op !== 'replace' ? 1 : undefined,
          endLine: op === 'replace_range' || op === 'delete' ? 5 : undefined,
        };
        expect(() => tool.schema.parse(validData)).not.toThrow();
      }
    });

    it('should reject invalid operation value', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        operation: 'invalid' as any,
        content: 'content',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should accept optional content field', () => {
      const validData = {
        filePath: '/path/to/file.ts',
        operation: 'delete' as const,
        startLine: 1,
        endLine: 5,
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept optional startLine and endLine fields', () => {
      const validData = {
        filePath: '/path/to/file.ts',
        operation: 'replace' as const,
        content: 'new content',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject non-positive startLine', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        operation: 'insert' as const,
        content: 'content',
        startLine: 0,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-positive endLine', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        operation: 'delete' as const,
        startLine: 1,
        endLine: 0,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer startLine', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        operation: 'insert' as const,
        content: 'content',
        startLine: 1.5,
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject non-integer endLine', () => {
      const invalidData = {
        filePath: '/path/to/file.ts',
        operation: 'delete' as const,
        startLine: 1,
        endLine: 5.5,
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

    it('should replace entire file successfully', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: 'new file content\nline 2',
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
          stdout: '2\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(2);
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledTimes(2);
    });

    it('should create parent directories when replacing a file', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/new/path/nested/file.ts',
        operation: 'replace',
        content: 'content',
      };

      const execSpy = vi
        .spyOn(tool as any, 'execCommand')
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '1\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(execSpy).toHaveBeenCalledTimes(2);
      const firstCallArgs = execSpy.mock.calls[0]?.[0] as
        | { cmd?: string }
        | undefined;
      expect(firstCallArgs?.cmd).toContain('mkdir -p "/new/path/nested"');
    });

    it('should replace line range successfully', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace_range',
        content: 'replaced content\n',
        startLine: 2,
        endLine: 4,
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
          stdout: '10\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(10);
      expect(result.error).toBeUndefined();
    });

    it('should insert content at specific line successfully', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'insert',
        content: 'inserted line\n',
        startLine: 3,
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
          stdout: '5\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(5);
      expect(result.error).toBeUndefined();
    });

    it('should delete line range successfully', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'delete',
        startLine: 2,
        endLine: 4,
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
          stdout: '7\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(7);
      expect(result.error).toBeUndefined();
    });

    it('should return error when content is missing for replace operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'replace' as const,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('content is required for replace operation');
    });

    it('should return error when content is missing for replace_range operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'replace_range' as const,
        startLine: 1,
        endLine: 5,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'content is required for replace_range operation',
      );
    });

    it('should return error when content is missing for insert operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'insert' as const,
        startLine: 1,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('content is required for insert operation');
    });

    it('should return error when startLine is missing for replace_range operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'replace_range' as const,
        content: 'content',
        endLine: 5,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'startLine is required for replace_range operation',
      );
    });

    it('should return error when startLine is missing for insert operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'insert' as const,
        content: 'content',
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('startLine is required for insert operation');
    });

    it('should return error when startLine is missing for delete operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'delete' as const,
        endLine: 5,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('startLine is required for delete operation');
    });

    it('should return error when endLine is missing for replace_range operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'replace_range' as const,
        content: 'content',
        startLine: 1,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'endLine is required for replace_range operation',
      );
    });

    it('should return error when endLine is missing for delete operation', async () => {
      const args = {
        filePath: '/path/to/file.ts',
        operation: 'delete' as const,
        startLine: 1,
      } as FilesApplyChangesToolSchemaType;

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('endLine is required for delete operation');
    });

    it('should return error when startLine is greater than endLine', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace_range',
        content: 'content',
        startLine: 10,
        endLine: 5,
      };

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'startLine must be less than or equal to endLine',
      );
    });

    it('should return error when command fails', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/nonexistent.ts',
        operation: 'replace',
        content: 'content',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'No such file or directory',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No such file or directory');
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: 'content',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: 'Error: Permission denied',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error: Permission denied');
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: 'content',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to apply changes');
    });

    it('should handle file path with spaces', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to my file.ts',
        operation: 'replace',
        content: 'content',
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
          stdout: '1\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should handle content with special characters', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: 'content with $pecial chars & symbols\nnew line',
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
          stdout: '2\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(2);
    });

    it('should handle empty content for replace operation', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: '',
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
          stdout: '0\n',
          stderr: '',
          execPath: '/runtime-workspace/test-thread-123',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBe(0);
    });

    it('should handle line count command failure gracefully', async () => {
      const args: FilesApplyChangesToolSchemaType = {
        filePath: '/path/to/file.ts',
        operation: 'replace',
        content: 'content',
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
          stderr: 'wc: error',
          execPath: '',
        });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.lineCount).toBeUndefined();
    });
  });
});
