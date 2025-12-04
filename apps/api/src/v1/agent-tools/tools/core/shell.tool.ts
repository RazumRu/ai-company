import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { execRuntimeWithContext } from '../../agent-tools.utils';
import { BaseTool, ExtendedLangGraphRunnableConfig } from '../base-tool';

export interface ShellToolOptions {
  runtime: BaseRuntime | (() => BaseRuntime);
  env?: Record<string, string>;
  additionalInfo?: string;
}

export const ShellToolSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  tailTimeoutMs: z.number().int().positive().optional(),
  env: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  maxOutputLength: z
    .number()
    .int()
    .positive()
    .default(10000)
    .describe(
      'Maximum length of output. If output exceeds this length, only the last N characters will be returned. Useful to prevent context size increase. Default: 10000.',
    ),
});
export type ShellToolSchemaType = z.infer<typeof ShellToolSchema>;

export interface ShellToolOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

@Injectable()
export class ShellTool extends BaseTool<ShellToolSchemaType, ShellToolOptions> {
  public name = 'shell';
  public description =
    'Executes arbitrary shell commands inside the prepared Docker runtime. Use it for files, git, tests, builds, installs, inspection. Returns stdout, stderr, exitCode. If command output is expected to be large (e.g. rg, ls -R, test logs), consider constraining it with flags (-n, --max-count, specific paths) instead of dumping full repo logs.';

  public get schema() {
    return ShellToolSchema;
  }

  public build(
    config: ShellToolOptions,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool {
    const enhancedDescription = config.additionalInfo
      ? `${this.description}\n\n${config.additionalInfo}`
      : this.description;

    return this.toolWrapper(this.invoke, config, {
      ...lgConfig,
      description: enhancedDescription,
    });
  }

  public async invoke(
    data: ShellToolSchemaType,
    config: ShellToolOptions,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ShellToolOutput> {
    // Get environment variables from config
    const configEnv = config.env || {};

    // Convert provided env array to object
    const providedEnv = data.env
      ? Object.fromEntries(data.env.map((v) => [v.key, v.value]))
      : {};

    // Merge config env with provided env (provided env takes precedence)
    const mergedEnv = { ...configEnv, ...providedEnv };

    // Extract purpose and maxOutputLength from data before passing to runtime.exec
    const { purpose: _purpose, maxOutputLength, ...execData } = data;

    // Trim output to last N characters if it exceeds maxOutputLength
    const trimOutput = (output: string): string => {
      if (maxOutputLength && output.length > maxOutputLength) {
        return output.slice(-maxOutputLength);
      }
      return output;
    };

    try {
      const res = await execRuntimeWithContext(
        config.runtime,
        {
          ...execData,
          env: mergedEnv,
        },
        cfg,
      );

      return {
        exitCode: res.exitCode,
        stdout: trimOutput(res.stdout),
        stderr: trimOutput(res.stderr),
      };
    } catch (error) {
      // Handle runtime errors by returning them in the expected RuntimeExecResult format
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        exitCode: 1,
        stdout: '',
        stderr: trimOutput(errorMessage),
      };
    }
  }
}
