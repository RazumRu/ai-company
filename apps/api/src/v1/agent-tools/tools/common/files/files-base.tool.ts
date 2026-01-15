import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RuntimeThreadProvider } from '../../../../runtime/services/runtime-thread-provider';
import { execRuntimeWithContext } from '../../../agent-tools.utils';
import { BaseTool } from '../../base-tool';

export type FilesBaseToolConfig = {
  runtimeProvider: RuntimeThreadProvider;
};

@Injectable()
export abstract class FilesBaseTool<
  TSchema,
  TConfig extends FilesBaseToolConfig = FilesBaseToolConfig,
  TResult = unknown,
> extends BaseTool<TSchema, TConfig, TResult> {
  protected async execCommand(
    params: {
      cmd: string[] | string;
      timeoutMs?: number;
      tailTimeoutMs?: number;
    },
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    const cmdWrapped =
      typeof params.cmd === 'string'
        ? `( ${params.cmd} )`
        : params.cmd.map((c) => `( ${c} )`);

    try {
      const runtime = await config.runtimeProvider.provide(cfg);

      const res = await execRuntimeWithContext(
        runtime,
        {
          cmd: cmdWrapped,
          timeoutMs: params.timeoutMs ?? 30_000,
          tailTimeoutMs: params.tailTimeoutMs ?? 10_000,
        },
        cfg,
      );

      return {
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        execPath: res.execPath,
      };
    } catch (error) {
      // Handle runtime errors by returning them in the expected RuntimeExecResult format
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        exitCode: 1,
        stdout: '',
        stderr: errorMessage,
        execPath: '',
      };
    }
  }
}
