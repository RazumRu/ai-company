import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../environments';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { RequestTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../litellm/services/llm-models.service';
import {
  CompleteData,
  OpenaiService,
  ResponseData,
} from '../../../openai/openai.service';
import { BASE_RUNTIME_WORKDIR } from '../../../runtime/services/base-runtime';
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
      `The shell command to execute. Supports pipes, chaining (&&, ||), and subshells. Use absolute paths under ${BASE_RUNTIME_WORKDIR} for reliability.`,
    ),
  timeoutMs: z
    .number()
    .positive()
    .nullable()
    .optional()
    .describe(
      'Maximum time to wait in milliseconds (default: 300000 = 5 minutes)',
    ),
  tailTimeoutMs: z
    .number()
    .positive()
    .nullable()
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
    .nullable()
    .optional()
    .describe(
      'Environment variables to set for this command. These are merged with any pre-configured env vars and persist for the session.',
    ),
  outputFocus: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Describe what specific information you need from the command output. ' +
        'When set, a small model reads the raw stdout/stderr, extracts only the parts you asked for, and returns them in `focusResult`. ' +
        'stdout and stderr will be empty — all relevant content is in `focusResult`. ' +
        'This drastically reduces token usage for commands that produce large output (e.g., build logs, test results, long listings). ' +
        'Examples: "only the failing test names and their error messages", "the installed package versions", "just the error lines and 2 lines of context around each". ' +
        'Omit to receive the full (possibly truncated) raw output.',
    ),
});

export type ShellToolSchemaType = z.infer<typeof ShellToolSchema>;

export interface ShellToolOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * When present, contains an AI-extracted summary of the raw output
   * based on the `outputFocus` instruction. The caller should use this
   * field instead of parsing the full stdout/stderr.
   */
  focusResult?: string;
}

@Injectable()
export class ShellTool extends BaseTool<ShellToolSchemaType, ShellToolOptions> {
  public name = 'shell';
  public description =
    'Execute a shell command inside the runtime container and return its exit code, stdout, and stderr. Commands within the same thread share a persistent session, so environment variables and working directory changes (cd) persist across calls. Output is automatically truncated to fit within the configured token budget. Use this for git operations, build/test/install commands, and system inspection — but prefer specialized file tools (files_read, files_search_text, etc.) for reading, searching, and editing files.';

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly litellmService: LitellmService,
    private readonly llmModelsService: LlmModelsService,
  ) {
    super();
  }

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
      Executes shell commands in runtime environment. Commands within same thread share persistent session (env/cwd persist). Default cwd: \`${BASE_RUNTIME_WORKDIR}\`. Use absolute paths under \`${BASE_RUNTIME_WORKDIR}\` for cross-tool compatibility.

      ### CRITICAL: Working Directory After Clone
      - Default starting directory: ${BASE_RUNTIME_WORKDIR}
      - After gh_clone returns {"path": "${BASE_RUNTIME_WORKDIR}/my-repo"}:
        - Either: \`cd ${BASE_RUNTIME_WORKDIR}/my-repo\` first
        - Or: use full absolute paths in all commands

      ### Common Mistake
      ❌ \`npm install\` right after clone (still in ${BASE_RUNTIME_WORKDIR} - will fail!)
      ✅ \`cd ${BASE_RUNTIME_WORKDIR}/my-repo && npm install\`
      ✅ Or: run \`cd ${BASE_RUNTIME_WORKDIR}/my-repo\` first, then \`npm install\` in next command

      ### Session Persistence
      - \`cd\` changes persist between shell calls within the same thread
      - No need to repeat \`cd\` if already in correct directory
      - Environment variables also persist

      **Example:**
      \`\`\`bash
      # First command: change directory
      cd ${BASE_RUNTIME_WORKDIR}/myproject

      # Second command: you're ALREADY in ${BASE_RUNTIME_WORKDIR}/myproject
      npm install  # NO need for "cd && npm install"

      # Third command: still in the same directory
      npm test  # Still in ${BASE_RUNTIME_WORKDIR}/myproject
      \`\`\`

      ### When to Use
      Git operations, build/test/install commands, system inspection, custom scripts, or when specialized tools don't exist.

      ### When NOT to Use
      - For reading/finding/searching/editing files → use specialized file tools (better structured output, safer operations).
      - For listing directories or exploring file structure → use \`files_directory_tree\` or \`files_find_paths\`. Never use \`ls\`, \`find\`, or \`tree\` shell commands for directory exploration — file tools are faster and produce better output.

      ### Use \`outputFocus\` for Build/Test/Lint/Install Commands
      Build, test, lint, and install commands typically produce large output. Use \`outputFocus\` as the default approach for these commands to avoid wasting context window tokens. If the focused result lacks detail you need, you can re-run without \`outputFocus\` to get the full output.

      When \`outputFocus\` is set, a small model reads the raw stdout/stderr, extracts only the parts you asked for, and returns them in the \`focusResult\` field. \`stdout\` and \`stderr\` will be empty — all relevant content is in \`focusResult\`. If extraction fails, you receive raw (truncated) output as a fallback.

      **Examples — build/test/lint with \`outputFocus\`:**
      \`\`\`json
      {"command": "npm install", "purpose": "Install deps", "outputFocus": "only warnings, errors, and the final added/removed summary"}
      {"command": "npm run build", "purpose": "Build project", "outputFocus": "pass/fail status only. If failed, list only the error messages"}
      {"command": "npm test", "purpose": "Run tests", "outputFocus": "pass/fail status: total tests, passed count, failed count. If any failed, list their names and error messages"}
      {"command": "npm run lint", "purpose": "Lint code", "outputFocus": "pass/fail status: number of errors and warnings. If any errors, list only the file paths and rule names"}
      \`\`\`

      ### Avoid Duplicate Command Runs
      Track which commands you have already run and their results. Do not run the same test/build/lint command more than once unless you made code changes in between. Running the same command repeatedly wastes time and tokens.
      If a test fails, fix the code first, then re-run — but use the exact same invocation method (do not switch between different test runners).

      ### Best Practices
      **1. Quote paths with spaces:**
      \`\`\`bash
      cat "/path/with spaces/file.txt"
      \`\`\`

      **2. Constrain output to avoid token waste:**
      \`\`\`bash
      rg "TODO" --max-count=10 /workspace/src
      \`\`\`

      **3. Use \`outputFocus\` for any large output:**
      Beyond build/test/lint, use \`outputFocus\` whenever output may be large and you only need specific information.

      **Examples — extracting specific content:**
      \`\`\`json
      {"command": "cat package.json", "purpose": "Check deps", "outputFocus": "only the dependencies and devDependencies sections"}
      {"command": "git log --oneline -20", "purpose": "Recent commits", "outputFocus": "list of commit hashes and messages"}
      \`\`\`

      **Examples — status-only checks:**
      \`\`\`json
      {"command": "tsc --noEmit", "purpose": "Type-check project", "outputFocus": "pass/fail status: number of type errors. If any, list only the first 5 file:line and error message"}
      {"command": "docker compose ps", "purpose": "Check services health", "outputFocus": "for each service: name and status (running/stopped/unhealthy). Omit ports and other details"}
      \`\`\`

      Always check exitCode (0=success, non-zero=failure) before assuming success.

      ${runtimeInfo || ''}

      ${config.resourcesInformation ? `### Additional information\n\n${config.resourcesInformation}` : ''}
    `;
  }

  /**
   * Calls the extraction LLM and assembles the focused tool result.
   * On extraction failure falls back to raw (truncated) output.
   */
  private async buildFocusedResult(
    outputFocus: string,
    stdout: string,
    stderr: string,
    exitCode: number,
    title: string,
  ): Promise<ToolInvokeResult<ShellToolOutput>> {
    try {
      const { focusResult, usage } = await this.extractFocusedOutput(
        outputFocus,
        stdout,
        stderr,
        exitCode,
      );

      return {
        output: {
          exitCode,
          stdout: '',
          stderr: '',
          focusResult,
        },
        messageMetadata: { __title: title },
        toolRequestUsage: usage,
      };
    } catch {
      // Extraction failed — fall back to raw output
      return {
        output: { exitCode, stdout, stderr },
        messageMetadata: { __title: title },
      };
    }
  }

  /**
   * Uses a small LLM to extract only the relevant parts of the shell output
   * based on the `outputFocus` instruction. Returns the extracted text and
   * token usage for cost tracking.
   */
  private async extractFocusedOutput(
    outputFocus: string,
    stdout: string,
    stderr: string,
    exitCode: number,
  ): Promise<{ focusResult: string; usage?: RequestTokenUsage }> {
    const modelName = this.llmModelsService.getKnowledgeSearchModel();
    const supportsResponsesApi =
      await this.litellmService.supportsResponsesApi(modelName);

    const systemMessage = dedent`
      You are a shell output extractor. Given raw stdout/stderr from a command,
      extract ONLY the parts the user asked for. Be concise — return only the
      relevant lines/data, no commentary or explanation. If nothing matches,
      respond with "No matching output found."
    `;

    const parts: string[] = [];
    if (stdout) parts.push(`STDOUT:\n${stdout}`);
    if (stderr) parts.push(`STDERR:\n${stderr}`);
    parts.push(`EXIT CODE: ${exitCode}`);

    const message = dedent`
      Extract from the following shell output: "${outputFocus}"

      ${parts.join('\n\n')}
    `;

    const data: ResponseData | CompleteData = {
      model: modelName,
      message,
      systemMessage,
    };

    const response = supportsResponsesApi
      ? await this.openaiService.response(data)
      : await this.openaiService.complete(data);

    return {
      focusResult: response.content ?? 'No matching output found.',
      usage: response.usage,
    };
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
      command,
      timeoutMs,
      tailTimeoutMs,
      outputFocus,
    } = data;

    // Trim output to last N characters based on token budget.
    // Approximate 1 token ≈ 4 characters for a safe character limit.
    // When outputFocus is set the caller only needs a subset of the output,
    // so we cut to 25 % of the normal budget to save tokens.
    const fullBudgetChars = (environment.toolMaxOutputTokens || 5000) * 4;
    const maxOutputChars = outputFocus
      ? Math.max(Math.round(fullBudgetChars * 0.25), 4000)
      : fullBudgetChars;
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
          timeoutMs: timeoutMs ?? undefined,
          tailTimeoutMs: tailTimeoutMs ?? undefined,
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
        stderr = `${stderr}\n\nTIP: You may be in the wrong directory. After cloning a repo with gh_clone, you must cd into it first (e.g., cd ${BASE_RUNTIME_WORKDIR}/repo-name) before running npm/pnpm commands.`;
      }

      if (outputFocus) {
        return this.buildFocusedResult(
          outputFocus,
          trimOutput(res.stdout),
          trimOutput(stderr),
          res.exitCode,
          title,
        );
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

      if (outputFocus) {
        return this.buildFocusedResult(
          outputFocus,
          '',
          trimOutput(errorMessage),
          1,
          title,
        );
      }

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
