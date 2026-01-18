import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesCreateDirectoryTool } from './files-create-directory.tool';

describe('FilesCreateDirectoryTool', () => {
  let tool: FilesCreateDirectoryTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockConfig = { runtimeProvider: { provide: vi.fn() } as any };
    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesCreateDirectoryTool],
    }).compile();
    tool = module.get<FilesCreateDirectoryTool>(FilesCreateDirectoryTool);
  });

  it('creates directory via mkdir -p', async () => {
    const cfg: ToolRunnableConfig<BaseAgentConfigurable> = {
      configurable: { thread_id: 't' },
    };

    const execSpy = vi.spyOn(tool as any, 'execCommand').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      execPath: '/runtime-workspace/t',
    });

    const { output } = await tool.invoke(
      { directoryPath: '/repo/new-dir' },
      mockConfig,
      cfg,
    );

    expect(output.success).toBe(true);
    expect(execSpy).toHaveBeenCalled();
  });
});
