import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesSearchTextTool,
  FilesSearchTextToolSchema,
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
      runtimeProvider: {
        provide: vi.fn().mockResolvedValue(mockRuntime),
      } as any,
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
      expect(tool.description).toContain('Search file contents');
      expect(tool.description).toContain('regex pattern');
    });
  });

  describe('schema', () => {
    it('should validate textPattern field (searchInDirectory optional)', () => {
      const validData = {
        textPattern: 'function',
      };
      expect(() => FilesSearchTextToolSchema.parse(validData)).not.toThrow();
    });

    it('should reject missing textPattern field', () => {
      const invalidData = {
        searchInDirectory: '/path/to/repo',
      };
      expect(() => FilesSearchTextToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty searchInDirectory', () => {
      const invalidData = {
        searchInDirectory: '',
        textPattern: 'function',
      };
      expect(() => FilesSearchTextToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty textPattern', () => {
      const invalidData = {
        searchInDirectory: '/path/to/repo',
        textPattern: '',
      };
      expect(() => FilesSearchTextToolSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional filePath field', () => {
      const validData = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        filePath: '/path/to/repo/src/file.ts',
      };
      expect(() => FilesSearchTextToolSchema.parse(validData)).not.toThrow();
    });

    it('should accept optional onlyInFilesMatching field', () => {
      const validData = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        onlyInFilesMatching: ['*.ts', 'src/**'],
      };
      expect(() => FilesSearchTextToolSchema.parse(validData)).not.toThrow();
    });

    it('should accept optional skipFilesMatching field', () => {
      const validData = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        skipFilesMatching: ['*.test.ts', 'node_modules/**'],
      };
      expect(() => FilesSearchTextToolSchema.parse(validData)).not.toThrow();
    });

    it('should accept all optional fields together', () => {
      const validData = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        filePath: '/path/to/repo/src/file.ts',
        onlyInFilesMatching: ['*.ts'],
        skipFilesMatching: ['*.test.ts'],
      };
      expect(() => FilesSearchTextToolSchema.parse(validData)).not.toThrow();
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should search text successfully with basic textPattern', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.matches![0]!.filePath).toBe('src/file.ts');
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain('rg --json --hidden');
      expect(call.cmd).toContain("cd '/path/to/repo' &&");
      expect(call.cmd).toContain("'!.git/**'");
      expect(call.cmd).toContain("'!node_modules/**'");
      expect(call.cmd).toContain("'!.next/**'");
      expect(call.cmd).toContain("'!dist/**'");
      expect(call.cmd).toContain("'!build/**'");
      expect(call.cmd).toContain("'!coverage/**'");
    });

    it('should search text with include globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        onlyInFilesMatching: ['*.ts', 'src/**'],
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain("cd '/path/to/repo' &&");
      expect(call.cmd).toContain("--glob '*.ts'");
      expect(call.cmd).toContain("--glob 'src/**'");
      expect(call.cmd).toContain("'!node_modules/**'");
    });

    it('should search text with exclude globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        skipFilesMatching: ['*.test.ts', 'node_modules/**'],
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain("cd '/path/to/repo' &&");
      expect(call.cmd).toContain("--glob '!*.test.ts'");
      expect(call.cmd).toContain("'!node_modules/**'");
    });

    it('should search text with include and exclude globs', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        onlyInFilesMatching: ['*.ts'],
        skipFilesMatching: ['*.test.ts'],
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain("cd '/path/to/repo' &&");
      expect(call.cmd).toContain("--glob '*.ts'");
      expect(call.cmd).toContain("--glob '!*.test.ts'");
    });

    it('should search text in specific file', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
        filePath: '/path/to/repo/src/file.ts',
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: '/path/to/repo/src/file.ts' },
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain("cd '/path/to/repo' &&");
      expect(call.cmd).toContain(
        "rg --json -- 'function' '/path/to/repo/src/file.ts'",
      );
    });

    it('should return empty matches when no results found', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'nonexistent',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('should parse multiple JSON match results', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(2);
      expect(result.matches![0]!.filePath).toBe('src/file1.ts');
      expect(result.matches![1]!.filePath).toBe('src/file2.ts');
      expect(result.error).toBeUndefined();
    });

    it('should cap matches at 15 results', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
      };

      const matches = Array.from({ length: 35 }).map((_, idx) =>
        JSON.stringify({
          type: 'match',
          data: {
            path: { text: `src/file${idx}.ts` },
            lines: { text: `export function test${idx}() {}` },
            line_number: idx + 1,
          },
        }),
      );

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: matches.join('\n'),
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(15);
      expect(result.matches![0]!.filePath).toBe('src/file0.ts');
      expect(result.matches![14]!.filePath).toBe('src/file14.ts');
    });

    it('should skip non-match JSON lines', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.matches![0]!.filePath).toBe('src/file.ts');
      expect(result.error).toBeUndefined();
    });

    it('should return error when command fails with stderr', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: 'rg: error: invalid pattern',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('rg: error: invalid pattern');
      expect(result.matches).toBeUndefined();
    });

    it('should return error message from stdout when stderr is empty', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: 'Error: ripgrep not found',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: ripgrep not found');
      expect(result.matches).toBeUndefined();
    });

    it('should return default error message when both stdout and stderr are empty', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to search text');
      expect(result.matches).toBeUndefined();
    });

    it('should handle file path with spaces', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to repo',
        textPattern: 'function',
        filePath: '/path/to repo/src/my file.ts',
      };

      const rgOutput = JSON.stringify({
        type: 'match',
        data: {
          path: { text: '/path/to repo/src/my file.ts' },
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).toContain("cd '/path/to repo' &&");
      expect(call.cmd).toContain(
        "rg --json -- 'function' '/path/to repo/src/my file.ts'",
      );
    });

    it('should handle invalid JSON lines gracefully', async () => {
      const args: FilesSearchTextToolSchemaType = {
        searchInDirectory: '/path/to/repo',
        textPattern: 'function',
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

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it('should handle search in current directory', async () => {
      const args: FilesSearchTextToolSchemaType = {
        textPattern: 'function',
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

      await tool.invoke(args, mockConfig, mockCfg);

      const call = (tool as any).execCommand.mock.calls[0]![0];
      expect(call.cmd).not.toContain('cd ');
      expect(call.cmd).toContain('rg --json --hidden');
    });
  });
});
