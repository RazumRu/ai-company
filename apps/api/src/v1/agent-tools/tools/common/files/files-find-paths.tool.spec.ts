import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-marker',
}));

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesFindPathsTool,
  FilesFindPathsToolSchema,
  FilesFindPathsToolSchemaType,
} from './files-find-paths.tool';

describe('FilesFindPathsTool', () => {
  let tool: FilesFindPathsTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockConfig = { runtime: { exec: vi.fn() } as unknown as BaseRuntime };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesFindPathsTool],
    }).compile();

    tool = module.get<FilesFindPathsTool>(FilesFindPathsTool);
  });

  it('validates schema', () => {
    const valid: FilesFindPathsToolSchemaType = {
      dir: '/repo',
      pattern: '**/*.ts',
    };
    expect(() => FilesFindPathsToolSchema.parse(valid)).not.toThrow();
  });

  it('returns matching files with cwd + metadata', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: [
        '__AI_FILES_FIND_PATHS_CWD_test-marker__',
        '/repo',
        '__AI_FILES_FIND_PATHS_FILES_test-marker__',
        '/repo/a.ts',
        '/repo/b.ts',
        '__AI_FILES_FIND_PATHS_EXIT_test-marker__:0',
        '',
      ].join('\n'),
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    const { output } = await tool.invoke(
      { dir: '/repo', pattern: '**/*.ts' },
      mockConfig,
      cfg,
    );

    expect(output.error).toBeUndefined();
    expect(output.cwd).toBe('/repo');
    expect(output.files).toEqual(['/repo/a.ts', '/repo/b.ts']);
    expect(output.returned).toBe(2);
    expect(output.truncated).toBe(false);
    expect(output.nextCursor).toBeNull();
    expect((tool as any).execCommand).toHaveBeenCalledWith(
      {
        cmd: expect.stringContaining("cd '/repo' &&"),
      },
      mockConfig,
      cfg,
    );
    expect((tool as any).execCommand).toHaveBeenCalledWith(
      {
        cmd: expect.stringContaining('fd --absolute-path'),
      },
      mockConfig,
      cfg,
    );
  });

  it('supports non-recursive listing', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: [
        '__AI_FILES_FIND_PATHS_CWD_test-marker__',
        '/repo',
        '__AI_FILES_FIND_PATHS_FILES_test-marker__',
        '/repo/a.ts',
        '__AI_FILES_FIND_PATHS_EXIT_test-marker__:0',
        '',
      ].join('\n'),
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    await tool.invoke(
      { dir: '/repo', pattern: '*', recursive: false },
      mockConfig,
      cfg,
    );

    expect((tool as any).execCommand).toHaveBeenCalledWith(
      {
        cmd: expect.stringContaining('--max-depth 1'),
      },
      mockConfig,
      cfg,
    );
  });

  it('truncates results when maxResults is reached', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: [
        '__AI_FILES_FIND_PATHS_CWD_test-marker__',
        '/repo',
        '__AI_FILES_FIND_PATHS_FILES_test-marker__',
        '/repo/1.ts',
        '/repo/2.ts',
        '/repo/3.ts',
        '__AI_FILES_FIND_PATHS_EXIT_test-marker__:0',
        '',
      ].join('\n'),
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    const { output } = await tool.invoke(
      { dir: '/repo', pattern: '**/*.ts', maxResults: 2 },
      mockConfig,
      cfg,
    );

    expect(output.error).toBeUndefined();
    expect(output.files).toEqual(['/repo/1.ts', '/repo/2.ts']);
    expect(output.returned).toBe(2);
    expect(output.truncated).toBe(true);
  });

  it('returns structured error output when command fails', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'fd: command not found',
      execPath: '',
    });

    const { output } = await tool.invoke(
      { dir: '/repo', pattern: '**/*.ts' },
      mockConfig,
      cfg,
    );

    expect(output.error).toBe('fd: command not found');
    expect(output.files).toEqual([]);
    expect(output.returned).toBe(0);
    expect(output.truncated).toBe(false);
    expect(output.nextCursor).toBeNull();
  });
});
