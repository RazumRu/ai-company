import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesSearchFilesTool,
  FilesSearchFilesToolSchema,
  FilesSearchFilesToolSchemaType,
} from './files-search-files.tool';

describe('FilesSearchFilesTool', () => {
  let tool: FilesSearchFilesTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockConfig = { runtime: { exec: vi.fn() } as unknown as BaseRuntime };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesSearchFilesTool],
    }).compile();

    tool = module.get<FilesSearchFilesTool>(FilesSearchFilesTool);
  });

  it('validates schema', () => {
    const valid: FilesSearchFilesToolSchemaType = {
      dir: '/repo',
      pattern: '**/*.ts',
    };
    expect(() => FilesSearchFilesToolSchema.parse(valid)).not.toThrow();
  });

  it('returns matching files', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: '/repo/a.ts\n/repo/b.ts\n',
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    const { output } = await tool.invoke(
      { dir: '/repo', pattern: '**/*.ts' },
      mockConfig,
      cfg,
    );

    expect(output.error).toBeUndefined();
    expect(output.files).toEqual(['/repo/a.ts', '/repo/b.ts']);
  });
});
