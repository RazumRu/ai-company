import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { RuntimeExecResult } from '../../runtime/runtime.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { BaseTool } from './base-tool';

export interface ShellToolOptions {
  runtime: BaseRuntime;
  env?: Record<string, string>;
  additionalInfo?: string;
}

export const ShellToolSchema = z.object({
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  tailTimeoutMs: z.number().int().positive().optional(),
  workdir: z.string().optional(),
  env: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
});
export type ShellToolSchemaType = z.infer<typeof ShellToolSchema>;

export interface ShellToolOutput extends RuntimeExecResult {
  cmd: string;
  env: ShellToolSchemaType['env'];
}

@Injectable()
export class ShellTool extends BaseTool<ShellToolSchemaType, ShellToolOptions> {
  public name = 'shell';
  public description =
    'Executes arbitrary shell commands inside the prepared Docker runtime. Use it for files, git, tests, builds, installs, inspection. Returns stdout, stderr, exitCode.';

  public get schema() {
    return ShellToolSchema;
  }

  public build(
    config: ShellToolOptions,
    lgConfig?: any,
  ): DynamicStructuredTool {
    const enhancedDescription = config.additionalInfo
      ? `${this.description}\n\nAvailable Resources:\n${config.additionalInfo}`
      : this.description;

    return this.toolWrapper(this.invoke, config, {
      ...lgConfig,
      description: enhancedDescription,
    });
  }

  public async invoke(
    data: ShellToolSchemaType,
    config: ShellToolOptions,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ShellToolOutput> {
    if (!config?.runtime) {
      throw new BadRequestException(
        undefined,
        'Runtime is required for ShellTool',
      );
    }

    // Get environment variables from config
    const configEnv = config.env || {};

    // Convert provided env array to object
    const providedEnv = data.env
      ? Object.fromEntries(data.env.map((v) => [v.key, v.value]))
      : {};

    // Merge config env with provided env (provided env takes precedence)
    const mergedEnv = { ...configEnv, ...providedEnv };

    const res = await config.runtime.exec({ ...data, env: mergedEnv });

    return {
      ...res,
      cmd: data.cmd,
      env: data.env,
    };
  }
}
