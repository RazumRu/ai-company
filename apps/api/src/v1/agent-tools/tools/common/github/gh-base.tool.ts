import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../../runtime/services/base-runtime';
import { execRuntimeWithContext } from '../../../agent-tools.utils';
import { BaseTool } from '../../base-tool';

export const GhBaseToolSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe('GitHub organization or user that owns the repository.'),
  repo: z.string().min(1).describe('Repository name (without .git).'),
});
export type GhBaseToolSchemaType = z.infer<typeof GhBaseToolSchema>;

export type GhBaseToolConfig = {
  runtime: BaseRuntime;
  patToken: string;
};

@Injectable()
export abstract class GhBaseTool<
  TSchema,
  TConfig extends GhBaseToolConfig = GhBaseToolConfig,
  TResult = unknown,
> extends BaseTool<TSchema, TConfig, TResult> {
  protected getClient(token: string) {
    return new Octokit({ auth: token });
  }

  protected async execGhCommand(
    params: { cmd: string[] | string },
    config: GhBaseToolConfig,
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
