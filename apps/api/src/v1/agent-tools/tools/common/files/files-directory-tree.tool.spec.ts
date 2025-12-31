import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import {
  FilesDirectoryTreeTool,
  FilesDirectoryTreeToolSchema,
  FilesDirectoryTreeToolSchemaType,
} from './files-directory-tree.tool';

describe('FilesDirectoryTreeTool', () => {
  let tool: FilesDirectoryTreeTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockConfig = { runtime: { exec: vi.fn() } as unknown as BaseRuntime };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesDirectoryTreeTool],
    }).compile();

    tool = module.get<FilesDirectoryTreeTool>(FilesDirectoryTreeTool);
  });

  it('validates schema', () => {
    const valid: FilesDirectoryTreeToolSchemaType = {
      path: '/repo',
      maxDepth: 3,
    };
    expect(() => FilesDirectoryTreeToolSchema.parse(valid)).not.toThrow();
  });

  it('builds a tree string', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: ['src', 'src/index.ts', 'README.md'].join('\n'),
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    const { output } = await tool.invoke({ path: '/repo' }, mockConfig, cfg);

    expect(output.error).toBeUndefined();
    expect(output.tree).toContain('repo');
    expect(output.tree).toContain('src');
    expect(output.tree).toContain('index.ts');
    expect(output.tree).toContain('README.md');
  });
});
