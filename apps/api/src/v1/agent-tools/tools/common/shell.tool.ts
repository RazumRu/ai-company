import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../environments';
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
  command: z
    .string()
    .min(1)
    .describe(
      'The shell command to execute. Supports pipes, chaining (&&, ||), and subshells. Use absolute paths under /runtime-workspace for reliability.',
    ),
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
    .describe(
      'Environment variables to set for this command. These are merged with any pre-configured env vars and persist for the session.',
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
    'Execute a shell command inside the runtime container and return its exit code, stdout, and stderr. Commands within the same thread share a persistent session, so environment variables and working directory changes (cd) persist across calls. Output is automatically truncated to fit within the configured token budget. Use this for git operations, build/test/install commands, and system inspection — but prefer specialized file tools (files_read, files_search_text, etc.) for reading, searching, and editing files.';

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

      ### CRITICAL: Working Directory After Clone
      - Default starting directory: /runtime-workspace
      - After gh_clone returns {"path": "/runtime-workspace/my-repo"}:
        - Either: \`cd /runtime-workspace/my-repo\` first
        - Or: use full absolute paths in all commands

      ### Common Mistake
      ❌ \`npm install\` right after clone (still in /runtime-workspace - will fail!)
      ✅ \`cd /runtime-workspace/my-repo && npm install\`
      ✅ Or: run \`cd /runtime-workspace/my-repo\` first, then \`npm install\` in next command

      ### Session Persistence
      - \`cd\` changes persist between shell calls within the same thread
      - No need to repeat \`cd\` if already in correct directory
      - Environment variables also persist

      **Example:**
      \`\`\`bash
      # First command: change directory
      cd /runtime-workspace/myproject

      # Second command: you're ALREADY in /runtime-workspace/myproject
      npm install  # NO need for "cd && npm install"

      # Third command: still in the same directory
      npm test  # Still in /runtime-workspace/myproject
      \`\`\`

      ### When to Use
      File/git operations, build/test/install commands, system inspection, custom scripts, or when specialized tools don't exist.

      ### When NOT to Use
      For reading/finding/searching/editing files → use specialized file tools (better structured output, safer operations).

      ### Best Practices
      **1. Quote paths with spaces:**
      \`\`\`bash
      cat "/path/with spaces/file.txt"
      \`\`\`

      **2. Constrain output to avoid token waste:**
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
    const { purpose: _purpose, command, timeoutMs, tailTimeoutMs } = data;

    // Trim output to last N characters based on token budget.
    // Approximate 1 token ≈ 4 characters for a safe character limit.
    const maxOutputChars = (environment.toolMaxOutputTokens || 5000) * 4;
    const trimOutput = (output: string): string => {
      if (output.length > maxOutputChars) {
        return output.slice(-maxOutputChars);
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

      let stderr = res.stderr;

      // Handle timeout
      if (res.exitCode === 124) {
        stderr = `${stderr ? `${stderr}\n` : ''}Command timed out after ${
          (res.timeout || timeoutMs) ?? 'the configured'
        } ms (exit code 124).`;
      }

      // Add helpful context for common directory-related errors
      if (
        res.exitCode !== 0 &&
        (stderr.includes('ENOENT') ||
          stderr.includes('No such file or directory') ||
          stderr.includes('No package.json') ||
          stderr.includes('ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND') ||
          stderr.includes("can't cd to"))
      ) {
        stderr = `${stderr}\n\nTIP: You may be in the wrong directory. After cloning a repo with gh_clone, you must cd into it first (e.g., cd /runtime-workspace/repo-name) before running npm/pnpm commands.`;
      }

      return {
        output: {
          exitCode: res.exitCode,
          stdout: trimOutput(res.stdout),
          stderr: trimOutput(stderr),
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
