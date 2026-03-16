import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/agents.types';
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
  resolveTokenForOwner?: (
    owner: string,
    userId?: string,
  ) => Promise<string | null>;
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
    cfg?: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string> {
    if (owner && config.resolveTokenForOwner) {
      const userId = cfg?.configurable?.thread_created_by;
      const token = await config.resolveTokenForOwner(owner, userId);
      if (token) {
        return token;
      }
    }
    throw new Error(
      'No GitHub token available. Install the GitHub App to authenticate.',
    );
  }

  protected async execGhCommand(
    params: {
      cmd: string[] | string;
      owner?: string;
      resolvedToken?: string | null;
    },
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    try {
      const runtime = await config.runtimeProvider.provide(cfg);

      // Resolve a token for GH_TOKEN injection.
      // When `resolvedToken` is provided (even null meaning "no token"), use it
      // directly to avoid a redundant resolveToken call. When it is undefined
      // (not provided), fall back to the internal resolveToken call for
      // backwards-compatible callers (e.g. detectDefaultBranch, findAgentInstructions).
      const env: Record<string, string> = {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/bin/false',
        SSH_ASKPASS: '/bin/false',
        GH_PROMPT_DISABLED: '1',
        GCM_INTERACTIVE: 'never',
      };
      if (params.resolvedToken !== undefined) {
        if (params.resolvedToken !== null) {
          env.GH_TOKEN = params.resolvedToken;
        }
        // null means "no token" — GH_TOKEN is intentionally omitted.
      } else {
        try {
          const token = await this.resolveToken(config, params.owner, cfg);
          env.GH_TOKEN = token;
        } catch {
          // No token available — plain git/find/cat commands work fine without GH_TOKEN.
        }
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
