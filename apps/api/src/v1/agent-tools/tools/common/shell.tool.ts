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
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  cmd: z.string(),
  timeoutMs: z.number().int().positive().optional().default(300_000),
  tailTimeoutMs: z.number().int().positive().optional().default(60_000),
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
    .default(10_000)
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
      The shell tool executes arbitrary shell commands inside a prepared runtime environment. It provides direct access to the command line for file operations, git commands, running tests, building projects, installing dependencies, and system inspection.
      Commands within the same thread share a persistent shell session (env and cwd changes persist across calls); session ids are handled automatically (keyed by threadId).
      By default, commands execute in a per-thread working directory under \`/runtime-workspace/<threadId>\`. If you want other tools (like Filesystem MCP) to reliably find files, prefer absolute paths under \`/runtime-workspace\` (for example \`/runtime-workspace/shared/... \`).

      ### When to Use
      - **File operations**: Creating, moving, copying, deleting files and directories
      - **Git operations**: Cloning repos, checking out branches, viewing diffs, committing changes
      - **Build & test**: Running build commands, executing test suites, linting code
      - **Package management**: Installing dependencies (npm, pip, apt, etc.)
      - **System inspection**: Checking disk space, viewing processes, inspecting environment
      - **Custom scripts**: Running project-specific scripts or one-off commands

      ### When NOT to Use
      - For reading file contents → prefer files_read tool (better structured output)
      - For listing/finding paths → prefer files_find_paths tool (structured array output)
      - For searching text in files → prefer files_search_text tool (JSON structured results)
      - For applying file changes → prefer files_apply_changes tool (safer, atomic operations)
      - When a specialized tool exists for the operation (use specialized tools for better reliability)

      ### Best Practices

      **1. Set the working directory once per session (cwd persists):**
      \`\`\`bash
      # First command in the thread: move to the runtime workspace
      cd /runtime-workspace && ls

      # Later commands in the same thread reuse that cwd automatically
      pnpm test
      git status
      \`\`\`

      **2. Quote paths with spaces:**
      \`\`\`bash
      cat "/path/with spaces/file.txt"
      \`\`\`

      **3. Chain commands safely with && to stop on first failure:**
      \`\`\`bash
      cd /repo && npm install && npm test
      \`\`\`

      **4. Use flags to constrain output:**
      \`\`\`bash
      # Good: Constrained
      rg "TODO" --max-count=10 /runtime-workspace/src

      # Bad: Potentially huge output
      rg "TODO" /runtime-workspace
      \`\`\`

      ### Output Format
      Returns:
      - \`exitCode\`: 0 for success, non-zero for failure
      - \`stdout\`: Standard output (trimmed to maxOutputLength)
      - \`stderr\`: Standard error output

      ### Error Handling
      - Always check exitCode before assuming success
      - Read stderr for error details when exitCode != 0
      - Retry transient failures (network, locks) with backoff
      - Don't ignore errors - report them and adjust strategy

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
    const providedEnv = data.env
      ? Object.fromEntries(data.env.map((v) => [v.key, v.value]))
      : {};

    // Merge config env with provided env (provided env takes precedence)
    const mergedEnv = { ...configEnv, ...providedEnv };

    // Extract non-runtime fields from data before passing to runtime.exec
    const { purpose: _purpose, maxOutputLength, ...execData } = data;

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
          ...execData,
          env: mergedEnv,
        },
        cfg,
      );

      const stderr =
        res.exitCode === 124
          ? trimOutput(
              `${res.stderr ? `${res.stderr}\n` : ''}Command timed out after ${
                (res.timeout || execData.timeoutMs) ?? 'the configured'
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
