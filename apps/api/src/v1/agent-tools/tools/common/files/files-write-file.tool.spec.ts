import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesWriteFileTool } from './files-write-file.tool';

describe('FilesWriteFileTool', () => {
  let tool: FilesWriteFileTool;
  let mockConfig: FilesBaseToolConfig;

  beforeEach(async () => {
    mockConfig = { runtimeProvider: { provide: vi.fn() } as any };
    const module: TestingModule = await Test.createTestingModule({
      providers: [FilesWriteFileTool],
    }).compile();
    tool = module.get<FilesWriteFileTool>(FilesWriteFileTool);
  });

  it('writes full file content (overwrite)', async () => {
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
      { filePath: '/repo/a.txt', fileContent: 'hello\n' },
      mockConfig,
      cfg,
    );

    expect(output.success).toBe(true);
    const callArg = execSpy.mock.calls[0]?.[0] as
      | { cmd?: string | string[] }
      | undefined;
    const cmd =
      typeof callArg?.cmd === 'string'
        ? callArg.cmd
        : Array.isArray(callArg?.cmd)
          ? callArg.cmd.join(' && ')
          : '';
    expect(cmd).toContain('base64 -d');
    expect(cmd).toContain('mv --');
  });
});
