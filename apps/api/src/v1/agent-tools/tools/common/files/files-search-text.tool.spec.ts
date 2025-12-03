import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesSearchTextTool,
  FilesSearchTextToolSchemaType,
} from './files-search-text.tool';

describe('FilesSearchTextTool', () => {
  let tool: FilesSearchTextTool;
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
      providers: [FilesSearchTextTool],
    }).compile();

    tool = module.get<FilesSearchTextTool>(FilesSearchTextTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_search_text');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Search for text patterns');
      expect(tool.description).toContain('ripgrep');
    });
  });

  describe('schema', () => {
    it('should validate required dir and query fields', () => {
      const validData = {
        dir: '/path/to/repo',
        query: 'function',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing dir field', () => {
      const invalidData = {
        query: 'function',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing query field', () => {
      const invalidData = {
        dir: '/path/to/repo',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty dir', () => {
      const invalidData = {
        dir: '',
        query: 'function',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty query', () => {
      const invalidData = {
        dir: '/path/to/repo',
        query: '',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should accept optional filePath field', () => {
      const validData = {
        dir: '/path/to/repo',
        query: 'function',
        filePath: 'src/file.ts',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept optional includeGlobs field', () => {
      const validData = {
        dir: '/path/to/repo',
        query: 'function',
        includeGlobs: ['*.ts', 'src/**'],
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept optional excludeGlobs field', () => {
      const validData = {
        dir: '/path/to/repo',
        query: 'function',
        excludeGlobs: ['*.test.ts', 'node_modules/**'],
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should accept all optional fields together', () => {
      const validData = {
        dir: '/path/to/repo',
        query: 'function',
        filePath: 'src/file.ts',
        includeGlobs: ['*.ts'],
        excludeGlobs: ['*.test.ts'],
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

    it('should search text successfully with basic query', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.matches![0]!.data.path?.text).toBe('src/file.ts');
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && rg --json --hidden --glob \'!.git\' "function"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should search text with include globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
        includeGlobs: ['*.ts', 'src/**'],
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: "cd \"/path/to/repo\" && rg --json --hidden --glob '*.ts' --glob 'src/**' --glob '!.git' \"function\"",
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should search text with exclude globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
        excludeGlobs: ['*.test.ts', 'node_modules/**'],
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && rg --json --hidden --glob \'!*.test.ts\' --glob \'!node_modules/**\' "function"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should search text with include and exclude globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
        includeGlobs: ['*.ts'],
        excludeGlobs: ['*.test.ts'],
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && rg --json --hidden --glob \'*.ts\' --glob \'!*.test.ts\' "function"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should search text in specific file', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
        filePath: 'src/file.ts',
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && rg --json "function" "src/file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should return empty matches when no results found', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'nonexistent',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('should parse multiple JSON match results', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      const rgOutput = [
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'src/file1.ts' },
            lines: { text: 'export function test1() {}' },
            line_number: 10,
          },
        }),
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'src/file2.ts' },
            lines: { text: 'export function test2() {}' },
            line_number: 20,
          },
        }),
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(2);
      expect(result.matches![0]!.data.path?.text).toBe('src/file1.ts');
      expect(result.matches![1]!.data.path?.text).toBe('src/file2.ts');
      expect(result.error).toBeUndefined();
    });

    it('should skip non-match JSON lines', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      const rgOutput = [
        JSON.stringify({
          type: 'begin',
          data: { path: { text: 'src/file.ts' } },
        }),
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'src/file.ts' },
            lines: { text: 'export function test() {}' },
            line_number: 10,
          },
        }),
        JSON.stringify({ type: 'end', data: {} }),
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.matches![0]!.type).toBe('match');
      expect(result.error).toBeUndefined();
    });

    it('should return error when command fails with stderr', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: 'rg: error: invalid pattern',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('rg: error: invalid pattern');
      expect(result.matches).toBeUndefined();
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: 'Error: ripgrep not found',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: ripgrep not found');
      expect(result.matches).toBeUndefined();
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to search text');
      expect(result.matches).toBeUndefined();
    });

    it('should handle file path with spaces', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to repo',
        query: 'function',
        filePath: 'src/my file.ts',
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'src/my file.ts' },
          lines: { text: 'export function test() {}' },
          line_number: 10,
        },
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to repo" && rg --json "function" "src/my file.ts"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle invalid JSON lines gracefully', async () => {
      const args: FilesSearchTextToolSchemaType = {
        dir: '/path/to/repo',
        query: 'function',
      };

      const rgOutput = [
        'invalid json line',
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: 'src/file.ts' },
            lines: { text: 'export function test() {}' },
            line_number: 10,
          },
        }),
        'another invalid line',
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: rgOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const result = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.error).toBeUndefined();
    });
  });
});
