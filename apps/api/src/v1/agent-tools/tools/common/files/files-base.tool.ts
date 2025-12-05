import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { execRuntimeWithContext } from '../../../agent-tools.utils';
import { BaseTool } from '../../base-tool';

export type FilesBaseToolConfig = {
  runtime: BaseRuntime | (() => BaseRuntime);
};

@Injectable()
export abstract class FilesBaseTool<
  TSchema,
  TConfig extends FilesBaseToolConfig = FilesBaseToolConfig,
  TResult = unknown,
> extends BaseTool<TSchema, TConfig, TResult> {
  protected async execCommand(
    params: { cmd: string[] | string },
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    try {
      const res = await execRuntimeWithContext(
        config.runtime,
        {
          cmd: params.cmd,
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

