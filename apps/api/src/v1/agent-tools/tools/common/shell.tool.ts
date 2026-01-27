import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { execRuntimeWithContext } from '../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export interface ShellToolOptions {
  runtimeProvider: RuntimeThreadProvider;
  resourcesInformation?: string;
  env?: Record<string, string>;
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
    .positive()
    .optional()
    .describe(
      'Maximum time to wait in milliseconds (default: 300000 = 5 minutes)',
    ),
  tailTimeoutMs: z
    .number()
    .positive()
    .optional()
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
    .int()
    .positive()
    .optional()
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
    const runtimeInfo = this.buildRuntimeInfo(config.runtimeProvider);

    return dedent`
      ### Overview
      Executes shell commands in runtime environment. Commands within same thread share persistent session (env/cwd persist). Default cwd: \`/runtime-workspace\`. Use absolute paths under \`/runtime-workspace\` for cross-tool compatibility.

      **IMPORTANT: Persistent Shell Session**
      All commands execute in ONE continuous session - the current directory and environment variables persist between commands. Do NOT run \`cd\` at the beginning of every command; the working directory stays where you left it.

      ### When to Use
      File/git operations, build/test/install commands, system inspection, custom scripts, or when specialized tools don't exist.

      ### When NOT to Use
      For reading/finding/searching/editing files → use specialized file tools (better structured output, safer operations).

      ### Best Practices
      **1. Session persists - avoid redundant \`cd\` commands:**
      \`\`\`bash
      # First command: change directory
      cd /runtime-workspace/myproject

      # Second command: you're ALREADY in /runtime-workspace/myproject
      npm install  # NO need for "cd /runtime-workspace/myproject && npm install"

      # Third command: still in the same directory
      npm test  # Still in /runtime-workspace/myproject
      \`\`\`

      **2. Chain related commands (only when needed in single call):**
      \`\`\`bash
      # Only chain if you need it all in one command
      cd /repo && npm install && npm test

      # Better: use session persistence across separate commands
      # Command 1: cd /repo
      # Command 2: npm install  (already in /repo)
      # Command 3: npm test     (still in /repo)
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

  private buildRuntimeInfo(runtime: RuntimeThreadProvider) {
    const info = runtime.getRuntimeInfo();

    return dedent`
      ### Connected runtime information
      ${info}
    `;
  }

  public get schema() {
    return ShellToolSchema;
  }

  public async invoke(
    data: ShellToolSchemaType,
    config: ShellToolOptions,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<ShellToolOutput>> {
    // Convert provided env array to object
    const providedEnv = data.environmentVariables
      ? Object.fromEntries(
          data.environmentVariables.map((v) => [v.name, v.value]),
        )
      : {};

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
      const max = maxOutputLength || 10000;
      if (output.length > max) {
        return output.slice(-max);
      }
      return output;
    };

    const title = this.generateTitle(data, config);

    try {
      const mergedEnv = {
        ...(config.env || {}),
        ...providedEnv,
      };
      const runtime = await config.runtimeProvider.provide(cfg);
      const res = await execRuntimeWithContext(
        runtime,
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
