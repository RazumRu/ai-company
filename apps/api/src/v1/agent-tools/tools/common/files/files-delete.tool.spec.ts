import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesDeleteTool,
  FilesDeleteToolSchema,
  FilesDeleteToolSchemaType,
} from './files-delete.tool';

describe('FilesDeleteTool', () => {
  let tool: FilesDeleteTool;
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
      providers: [FilesDeleteTool],
    }).compile();

    tool = module.get<FilesDeleteTool>(FilesDeleteTool);
  });

  describe('properties', () => {
    it('should have correct name and description', () => {
      expect(tool.name).toBe('files_delete');
      expect(tool.description).toContain('Delete a single file');
      expect(tool.description).toContain('destructive');
    });
  });

  describe('schema', () => {
    it('accepts valid payload', () => {
      const data = { filePath: '/tmp/file.txt' };
      expect(() => FilesDeleteToolSchema.parse(data)).not.toThrow();
    });

    it('rejects empty file path', () => {
      const data = { filePath: '' };
      expect(() => FilesDeleteToolSchema.parse(data)).toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('deletes a file successfully', async () => {
      const args: FilesDeleteToolSchemaType = {
        filePath: '/tmp/to-delete.txt',
      };

      const execSpy = vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(execSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: expect.stringContaining('/tmp/to-delete.txt'),
        }),
        mockConfig,
        mockCfg,
      );
    });

    it('returns error when deletion fails', async () => {
      const args: FilesDeleteToolSchemaType = {
        filePath: '/tmp/missing.txt',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'File not found',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });
  });
});
