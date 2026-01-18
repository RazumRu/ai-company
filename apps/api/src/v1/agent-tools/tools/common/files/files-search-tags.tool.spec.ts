import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesSearchTagsTool,
  FilesSearchTagsToolSchema,
  FilesSearchTagsToolSchemaType,
} from './files-search-tags.tool';

describe('FilesSearchTagsTool', () => {
  let tool: FilesSearchTagsTool;
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
      providers: [FilesSearchTagsTool],
    }).compile();

    tool = module.get<FilesSearchTagsTool>(FilesSearchTagsTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('files_search_tags');
    });

    it('should have correct description', () => {
      expect(tool.description).toContain('Search symbol definitions');
      expect(tool.description).toContain('ctags index');
    });
  });

  describe('schema', () => {
    it('should validate required directoryPath, alias, and symbolQuery fields', () => {
      const validData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
      };
      expect(() => FilesSearchTagsToolSchema.parse(validData)).not.toThrow();
    });

    it('should allow missing directoryPath field (defaults to session cwd)', () => {
      const data = {
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
      };
      expect(() => FilesSearchTagsToolSchema.parse(data)).not.toThrow();
    });

    it('should reject missing alias field', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
        symbolQuery: 'MyFunction',
      };
      expect(() => FilesSearchTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject missing symbolQuery field', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
      };
      expect(() => FilesSearchTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty directoryPath', () => {
      const invalidData = {
        directoryPath: '',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
      };
      expect(() => FilesSearchTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty alias', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
        alias: '',
        symbolQuery: 'MyFunction',
      };
      expect(() => FilesSearchTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should reject empty symbolQuery', () => {
      const invalidData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: '',
      };
      expect(() => FilesSearchTagsToolSchema.parse(invalidData)).toThrow();
    });

    it('should accept optional exactMatch field', () => {
      const validData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };
      expect(() => FilesSearchTagsToolSchema.parse(validData)).not.toThrow();
    });

    it('should default exactMatch to false when not provided', () => {
      const validData = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
      };
      const parsed = FilesSearchTagsToolSchema.parse(validData);
      expect(parsed.exactMatch).toBe(false);
    });
  });

  describe('invoke', () => {
    const mockCfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: {
        thread_id: 'test-thread-123',
      },
    };

    it('should search tags with exact match successfully', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      const jqOutput = JSON.stringify({
        name: 'MyFunction',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect((result.matches![0] as any).name).toBe('MyFunction');
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name == "MyFunction")\' "/tmp/test-thread-123/myrepo.json"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should search tags with regex match successfully', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'My.*Function',
        exactMatch: false,
      };

      const jqOutput = [
        JSON.stringify({
          name: 'MyFunction',
          path: 'src/file.ts',
          line: 10,
          kind: 'function',
        }),
        JSON.stringify({
          name: 'MyOtherFunction',
          path: 'src/file2.ts',
          line: 20,
          kind: 'function',
        }),
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(2);
      expect((result.matches![0] as any).name).toBe('MyFunction');
      expect((result.matches![1] as any).name).toBe('MyOtherFunction');
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name | test("My.*Function"))\' "/tmp/test-thread-123/myrepo.json"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should default to regex match when exactMatch is not provided', async () => {
      const args = FilesSearchTagsToolSchema.parse({
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
      });

      const jqOutput = JSON.stringify({
        name: 'MyFunction',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name | test("MyFunction"))\' "/tmp/test-thread-123/myrepo.json"',
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

      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      const jqOutput = JSON.stringify({
        name: 'MyFunction',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/parent-thread-456',
      });

      const { output: result } = await tool.invoke(
        args,
        mockConfig,
        mockCfgWithParent,
      );

      expect(result.matches).toBeDefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name == "MyFunction")\' "/tmp/parent-thread-456/myrepo.json"',
        },
        mockConfig,
        mockCfgWithParent,
      );
    });

    it('should return empty matches when no results found', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'NonexistentFunction',
        exactMatch: true,
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
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'Function',
        exactMatch: false,
      };

      const jqOutput = [
        JSON.stringify({
          name: 'MyFunction',
          path: 'src/file1.ts',
          line: 10,
          kind: 'function',
        }),
        JSON.stringify({
          name: 'YourFunction',
          path: 'src/file2.ts',
          line: 20,
          kind: 'function',
        }),
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(2);
      expect((result.matches![0] as any).name).toBe('MyFunction');
      expect((result.matches![1] as any).name).toBe('YourFunction');
      expect(result.error).toBeUndefined();
    });

    it('should handle empty lines in output', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      const jqOutput = [
        '',
        JSON.stringify({
          name: 'MyFunction',
          path: 'src/file.ts',
          line: 10,
          kind: 'function',
        }),
        '',
        '',
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it('should return error when command fails with stderr', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: 'jq: error: parse error',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('jq: error: parse error');
      expect(result.matches).toBeUndefined();
    });

    it('should return error when command fails with stdout message', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: 'Error: File not found',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Error: File not found');
      expect(result.matches).toBeUndefined();
    });

    it('should return default error message when command fails with empty output', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: '',
        execPath: '',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.error).toBe('Failed to search tags');
      expect(result.matches).toBeUndefined();
    });

    it('should handle query with special characters in exact match', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'My"Function',
        exactMatch: true,
      };

      const jqOutput = JSON.stringify({
        name: 'My"Function',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      // Check that quotes are escaped
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name == "My\\"Function")\' "/tmp/test-thread-123/myrepo.json"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle query with special characters in regex match', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'My"Function',
        exactMatch: false,
      };

      const jqOutput = JSON.stringify({
        name: 'My"Function',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      // Check that quotes are escaped
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to/repo" && jq -c \'select(.name | test("My\\"Function"))\' "/tmp/test-thread-123/myrepo.json"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle directoryPath with spaces', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to my repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      const jqOutput = JSON.stringify({
        name: 'MyFunction',
        path: 'src/file.ts',
        line: 10,
        kind: 'function',
      });

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.error).toBeUndefined();
      expect((tool as any).execCommand).toHaveBeenCalledWith(
        {
          cmd: 'cd "/path/to my repo" && jq -c \'select(.name == "MyFunction")\' "/tmp/test-thread-123/myrepo.json"',
        },
        mockConfig,
        mockCfg,
      );
    });

    it('should handle invalid JSON lines gracefully', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: false,
      };

      const jqOutput = [
        'invalid json line',
        JSON.stringify({
          name: 'MyFunction',
          path: 'src/file.ts',
          line: 10,
          kind: 'function',
        }),
        'another invalid line',
      ].join('\n');

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: jqOutput,
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toBeDefined();
      expect(result.matches!.length).toBe(1);
      expect((result.matches![0] as any).name).toBe('MyFunction');
      expect(result.error).toBeUndefined();
    });

    it('should handle empty output', async () => {
      const args: FilesSearchTagsToolSchemaType = {
        directoryPath: '/path/to/repo',
        alias: 'myrepo',
        symbolQuery: 'MyFunction',
        exactMatch: true,
      };

      vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        execPath: '/runtime-workspace/test-thread-123',
      });

      const { output: result } = await tool.invoke(args, mockConfig, mockCfg);

      expect(result.matches).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });
});
