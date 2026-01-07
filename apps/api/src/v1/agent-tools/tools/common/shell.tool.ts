import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { execRuntimeWithContext } from '../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export interface ShellToolOptions {
  runtime: BaseRuntime;
  env?: Record<string, string>;
  resourcesInformation?: string;
}

export const ShellToolSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe(
      'Why you need to run this command (keep it brief, under 120 characters)',
    ),
  command: z.string().min(1).describe('The shell command to execute'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .default(300_000)
    .describe(
      'Maximum time to wait in milliseconds (default: 300000 = 5 minutes)',
    ),
  tailTimeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .default(60_000)
    .describe(
      'Time to keep listening after command finishes in milliseconds (default: 60000 = 1 minute)',
    ),
  environmentVariables: z
    .array(
      z.object({
        name: z.string().describe('Environment variable name'),
        value: z.string().describe('Environment variable value'),
      }),
    )
    .optional()
    .describe('Environment variables to set for this command'),
  maxOutputLength: z
    .number()
    .int()
    .positive()
    .default(10_000)
    .describe(
      'Maximum characters to return. If output exceeds this, only the last N characters are kept (default: 10000)',
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
    'Run arbitrary shell commands inside the runtime (output may be truncated).';

  protected override generateTitle(
    args: ShellToolSchemaType,
    _config: ShellToolOptions,
  ): string {
    return args.purpose;
  }

  public getDetailedInstructions(
    config: ShellToolOptions,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const runtimeInfo = this.buildRuntimeInfo(config.runtime);

    return dedent`
      ### Overview
      Executes shell commands in runtime environment. Commands within same thread share persistent session (env/cwd persist). Default cwd: \`/runtime-workspace/<threadId>\`. Use absolute paths under \`/runtime-workspace\` for cross-tool compatibility.

      ### When to Use
      File/git operations, build/test/install commands, system inspection, custom scripts, or when specialized tools don't exist.

      ### When NOT to Use
      For reading/finding/searching/editing files → use specialized file tools (better structured output, safer operations).

      ### Best Practices
      **1. Set cwd once (persists across calls):**
      \`\`\`bash
      cd /runtime-workspace && ls
      \`\`\`

      **2. Chain commands safely:**
      \`\`\`bash
      cd /repo && npm install && npm test
      \`\`\`

      **3. Quote paths with spaces:**
      \`\`\`bash
      cat "/path/with spaces/file.txt"
      \`\`\`

      **4. Constrain output to avoid token waste:**
      \`\`\`bash
      rg "TODO" --max-count=10 /workspace/src
      \`\`\`

      Always check exitCode (0=success, non-zero=failure) before assuming success.

      ${runtimeInfo || ''}

      ${config.resourcesInformation ? `### Additional information\n\n${config.resourcesInformation}` : ''}
    `;
  }

  private buildRuntimeInfo(runtime: ShellToolOptions['runtime']) {
    const info = runtime?.getRuntimeInfo?.();

    if (info) {
      return dedent`
      ### Connected runtime information
      ${info}
    `;
    }
  }

  public get schema() {
    return z.toJSONSchema(ShellToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    data: ShellToolSchemaType,
    config: ShellToolOptions,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<ShellToolOutput>> {
    // Get environment variables from config
    const configEnv = config.env || {};

    // Convert provided env array to object
    const providedEnv = data.environmentVariables
      ? Object.fromEntries(
          data.environmentVariables.map((v) => [v.name, v.value]),
        )
      : {};

    // Default env to prevent ANSI-colored output from commands like pnpm/vitest.
    // This keeps logs readable in UIs that don't interpret ANSI escapes, while still
    // allowing callers to override these values when needed.
    // CI=true and NODE_ENV=test make many tools (vitest, jest, pnpm, etc.) disable colors.
    const defaultEnv: Record<string, string> = {
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CLICOLOR: '0',
      CLICOLOR_FORCE: '0',
      TERM: 'dumb',
      CI: 'true',
      NODE_NO_WARNINGS: '1', // Suppress Node.js warnings that might contain ANSI
    };

    // Merge default env with config env and provided env (provided env takes precedence)
    const mergedEnv = { ...defaultEnv, ...configEnv, ...providedEnv };

    // Extract non-runtime fields from data before passing to runtime.exec
    const {
      purpose: _purpose,
      maxOutputLength,
      command,
      timeoutMs,
      tailTimeoutMs,
    } = data;

    // Trim output to last N characters if it exceeds maxOutputLength
    const trimOutput = (output: string): string => {
      if (maxOutputLength && output.length > maxOutputLength) {
        return output.slice(-maxOutputLength);
      }
      return output;
    };

    const title = this.generateTitle(data, config);

    try {
      const res = await execRuntimeWithContext(
        config.runtime,
        {
          cmd: command,
          timeoutMs,
          tailTimeoutMs,
          env: mergedEnv,
        },
        cfg,
      );

      const stderr =
        res.exitCode === 124
          ? trimOutput(
              `${res.stderr ? `${res.stderr}\n` : ''}Command timed out after ${
                (res.timeout || timeoutMs) ?? 'the configured'
              } ms (exit code 124).`,
            )
          : trimOutput(res.stderr);

      return {
        output: {
          exitCode: res.exitCode,
          stdout: trimOutput(res.stdout),
          stderr,
        },
        messageMetadata: {
          __title: title,
        },
      };
    } catch (error) {
      // Handle runtime errors by returning them in the expected RuntimeExecResult format
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        output: {
          exitCode: 1,
          stdout: '',
          stderr: trimOutput(errorMessage),
        },
        messageMetadata: {
          __title: title,
        },
      };
    }
  }
}
