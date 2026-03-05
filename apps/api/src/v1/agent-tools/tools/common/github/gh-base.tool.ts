import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { RuntimeThreadProvider } from '../../../../runtime/services/runtime-thread-provider';
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
  runtimeProvider: RuntimeThreadProvider;
  patToken?: string;
  resolveTokenForOwner?: (owner: string) => Promise<string | null>;
};

@Injectable()
export abstract class GhBaseTool<
  TSchema,
  TConfig extends GhBaseToolConfig = GhBaseToolConfig,
  TResult = unknown,
> extends BaseTool<TSchema, TConfig, TResult> {
  protected createClient(token: string): Octokit {
    return new Octokit({ auth: token });
  }

  protected async resolveToken(
    config: GhBaseToolConfig,
    owner?: string,
  ): Promise<string> {
    if (owner && config.resolveTokenForOwner) {
      const token = await config.resolveTokenForOwner(owner);
      if (token) return token;
    }
    if (config.patToken) return config.patToken;
    throw new Error(
      'No GitHub token available. Configure a PAT or install the GitHub App.',
    );
  }

  protected async execGhCommand(
    params: { cmd: string[] | string; owner?: string },
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    try {
      const runtime = await config.runtimeProvider.provide(cfg);

      // Resolve a token for GH_TOKEN injection.
      const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
      try {
        const token = await this.resolveToken(config, params.owner);
        env.GH_TOKEN = token;
      } catch {
        // No token available — GIT_TERMINAL_PROMPT=0 ensures git fails immediately
        // rather than waiting for an interactive credential prompt.
      }

      const res = await execRuntimeWithContext(
        runtime,
        {
          cmd: params.cmd,
          env,
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
