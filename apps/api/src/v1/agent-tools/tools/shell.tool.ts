import { DynamicStructuredTool, tool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseRuntime } from '../../runtime/services/base-runtime';
import { BaseTool } from './base-tool';

export interface ShellToolOptions {
  lgConfig?: LangGraphRunnableConfig;
  runtime: BaseRuntime;
}

@Injectable()
export class ShellTool extends BaseTool<ShellToolOptions> {
  public name = 'shell';
  public description =
    'Executes arbitrary shell commands inside the prepared Docker runtime. Use it for files, git, tests, builds, installs, inspection. Returns stdout, stderr, exitCode.';

  public get schema() {
    return z.object({
      cmd: z.string(),
      timeoutMs: z.number().int().positive().optional(),
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
  }

  public build(config?: ShellToolOptions): DynamicStructuredTool {
    return tool(async (args) => {
      const data = this.schema.parse(args);
      if (!config?.runtime) {
        throw new Error('Runtime is required for ShellTool');
      }

      const env =
        data.env && Object.fromEntries(data.env.map((v) => [v.key, v.value]));

      const res = await config.runtime.exec({ ...data, env });

      return res;
    }, this.buildToolConfiguration(config?.lgConfig));
  }
}
