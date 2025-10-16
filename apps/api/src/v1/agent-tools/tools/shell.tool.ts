import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { RuntimeExecResult } from '../../runtime/runtime.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { BaseTool } from './base-tool';

export interface ShellToolOptions {
  runtime: BaseRuntime;
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

  public async invoke(
    data: ShellToolSchemaType,
    config: ShellToolOptions,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ShellToolOutput> {
    if (!config?.runtime) {
      throw new Error('Runtime is required for ShellTool');
    }

    const env =
      data.env && Object.fromEntries(data.env.map((v) => [v.key, v.value]));

    const res = await config.runtime.exec({ ...data, env });

    return {
      ...res,
      cmd: data.cmd,
      env: data.env,
    };
  }
}
