import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import {
  SubAgent,
  SubagentRunResult,
} from '../../../../agents/services/agents/sub-agent';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import { RuntimeThreadProvider } from '../../../../runtime/services/runtime-thread-provider';
import { SubagentsService } from '../../../../subagents/subagents.service';
import {
  SubagentDefinition,
  SubagentPromptContext,
} from '../../../../subagents/subagents.types';
import { execRuntimeWithContext } from '../../../agent-tools.utils';
import {
  BaseTool,
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
  ToolInvokeStream,
} from '../../base-tool';
import { SubagentsToolGroupConfig } from './subagents.types';

export const SubagentsRunTaskToolSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .describe(
      'The ID of the subagent to run. Get available IDs from subagents_list. ' +
        'Example values: "system:explorer" (read-only codebase investigation), ' +
        '"system:simple" (general-purpose with full shell and file access), ' +
        '"system:smart" (high-capability with same model as parent agent).',
    ),
  task: z
    .string()
    .min(1)
    .describe(
      'A clear, self-contained description of the task to delegate. Include all context needed: ' +
        'file paths, specific questions, constraints, expected output format. The subagent cannot ' +
        'ask follow-up questions — it must be able to complete the task from this description alone.',
    ),
  purpose: z
    .string()
    .min(1)
    .describe(
      'Brief reason for delegating this task. Keep it short (< 120 chars).',
    ),
});

export type SubagentsRunTaskToolSchemaType = z.infer<
  typeof SubagentsRunTaskToolSchema
>;

export interface SubagentsRunTaskToolOutput {
  result: string;
  statistics?: SubagentRunResult['statistics'];
  error?: string;
}

@Injectable()
export class SubagentsRunTaskTool extends BaseTool<
  SubagentsRunTaskToolSchemaType,
  SubagentsToolGroupConfig,
  SubagentsRunTaskToolOutput
> {
  public name = 'subagents_run_task';
  public description =
    'Spawn a subagent to perform a self-contained task autonomously. ' +
    'The subagent runs in its own context window, absorbing verbose output (file reads, search results, ' +
    'command output) and returning only a concise result. Use this proactively for exploration, ' +
    'research, multi-file investigation, and self-contained code changes. ' +
    'Prefer delegation over doing it yourself for any task requiring 2+ tool calls.';

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly llmModelsService: LlmModelsService,
    private readonly subagentsService: SubagentsService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  public get schema() {
    return SubagentsRunTaskToolSchema;
  }

  protected override generateTitle(
    args: SubagentsRunTaskToolSchemaType,
  ): string {
    return `Calling subagent: ${args.purpose}`;
  }

  public getDetailedInstructions(
    _config: SubagentsToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Spawns a lightweight subagent with its own isolated context window. The subagent runs autonomously,
      processes all intermediate data (file reads, search results, command outputs) internally, and returns
      only a concise result to you. This keeps your main context clean and efficient.

      ### Key Benefit: Context Window Protection
      Every file you read and every command output you process consumes your context window.
      Subagents absorb this cost in their own window and return only the distilled result.
      **Always prefer delegation when a task would require reading multiple files or producing verbose output.**

      ### When to Use (Default: Delegate)
      - **Understanding code**: "How does feature X work?", "What does this module do?" → explorer
      - **Finding implementations**: "Where is Y defined/used?", "What calls Z?" → explorer
      - **Reading multiple files**: Any task requiring 3+ file reads → explorer
      - **Analyzing structure**: "What's the project layout?", "List all API endpoints" → explorer
      - **Cross-referencing**: Comparing implementations, tracing data flow across files → explorer
      - **Quick fixes**: Rename a variable, add an import, small single-file edit → simple
      - **Running a command**: Run lint, run a test, check build output → simple
      - **Code changes**: Well-defined modifications across 1+ files → smart
      - **Complex reasoning**: Architectural analysis, nuanced multi-step changes → smart
      - **Parallel research**: Multiple independent questions → spawn multiple explorers simultaneously

      ### When NOT to Use
      - Reading a single file you already know the path to
      - Running a single command with predictably short output
      - Tasks that require interactive clarification (subagents cannot ask questions)

      ### Choosing the Right Subagent
      - **"system:explorer"**: Read-only, fast model. Default for investigation, research, understanding code.
      - **"system:simple"**: Full access, small fast model, tiny 70k context. For quick, well-defined tasks: simple file edits, running a command, renaming, adding an import. NOT for complex reasoning.
      - **"system:smart"**: Full access, same large model as you. For complex reasoning, architectural analysis, nuanced code changes, multi-file modifications.

      ### Writing Effective Task Descriptions
      Subagents cannot ask follow-up questions. Your task description must be completely self-contained.
      Include: what to find/do, where to look, what format to return results in, and any constraints.

      **Good — specific, self-contained, with clear output expectations:**
      \`\`\`json
      {"agentId": "system:explorer", "task": "In ${BASE_RUNTIME_WORKDIR}/my-repo, find all files that import from '@auth' module. For each file, list: (1) the file path, (2) the specific named imports, (3) how they are used (function calls, class instantiation, etc). Start with codebase_search for '@auth' imports.", "purpose": "Map auth dependencies"}
      \`\`\`

      \`\`\`json
      {"agentId": "system:explorer", "task": "Investigate how the user authentication flow works in ${BASE_RUNTIME_WORKDIR}/my-repo. Trace from the login API endpoint through middleware, service, and database layers. Return a summary of: (1) all files involved, (2) the request lifecycle, (3) where tokens are generated and validated.", "purpose": "Understand auth flow"}
      \`\`\`

      \`\`\`json
      {"agentId": "system:smart", "task": "In ${BASE_RUNTIME_WORKDIR}/my-repo/src/utils/validators.ts, add a new export function 'isValidEmail(email: string): boolean' that validates email format using a regex. Follow the same style as existing validator functions in the file.", "purpose": "Add email validator"}
      \`\`\`

      **Bad — vague or missing context:**
      \`\`\`json
      {"agentId": "system:simple", "task": "Fix the bug", "purpose": "Fix bug"}
      \`\`\`
    `;
  }

  public async invoke(
    args: SubagentsRunTaskToolSchemaType,
    config: SubagentsToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<SubagentsRunTaskToolOutput>> {
    const title = this.generateTitle(args);

    const definition = this.subagentsService.getById(args.agentId);

    if (!definition) {
      return {
        output: {
          result: `Unknown agent ID "${args.agentId}"`,
          error: 'Invalid agentId',
        },
        messageMetadata: { __title: title },
      };
    }

    const { subAgent } = await this.prepareSubagent(
      definition,
      config,
      runnableConfig,
    );

    const loopResult = await subAgent.runSubagent(
      [new HumanMessage(args.task)],
      runnableConfig,
    );

    return this.buildResult(loopResult, title);
  }

  /**
   * Streaming invoke: yields intermediate BaseMessage[] chunks in real-time
   * as the subagent produces them. ToolExecutorNode emits each chunk via
   * caller_agent.emit() and collects them as additionalMessages for state.
   */
  public async *streamingInvoke(
    args: SubagentsRunTaskToolSchemaType,
    config: SubagentsToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): ToolInvokeStream<SubagentsRunTaskToolOutput> {
    const title = this.generateTitle(args);

    const definition = this.subagentsService.getById(args.agentId);

    if (!definition) {
      return {
        output: {
          result: `Unknown agent ID "${args.agentId}"`,
          error: 'Invalid agentId',
        },
        messageMetadata: { __title: title },
      };
    }

    const { subAgent } = await this.prepareSubagent(
      definition,
      config,
      runnableConfig,
    );

    // Queue-based message forwarding from subagent events
    const messageQueue: BaseMessage[][] = [];
    let resolveWaiting: (() => void) | null = null;
    let runDone = false;

    const unsubscribe = subAgent.subscribe((event) => {
      if (event.type === 'message' && event.data.messages.length > 0) {
        messageQueue.push(event.data.messages);
        if (resolveWaiting) {
          resolveWaiting();
          resolveWaiting = null;
        }
      }
      return Promise.resolve();
    });

    try {
      const runPromise = subAgent
        .runSubagent([new HumanMessage(args.task)], runnableConfig)
        .then((result) => {
          runDone = true;
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
          return result;
        });

      // Yield messages as they arrive until the run completes
      while (!runDone) {
        if (messageQueue.length > 0) {
          yield messageQueue.shift()!;
        } else {
          await new Promise<void>((r) => {
            resolveWaiting = r;
          });
        }
      }

      // Drain remaining messages
      while (messageQueue.length > 0) {
        yield messageQueue.shift()!;
      }

      const loopResult = await runPromise;

      return this.buildResult(loopResult, title);
    } finally {
      unsubscribe();
    }
  }

  private async prepareSubagent(
    definition: SubagentDefinition,
    config: SubagentsToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<{ subAgent: SubAgent }> {
    // Resolve tools from toolSets using definition's toolIds
    const tools: BuiltAgentTool[] = [];
    if (!config.toolSets) {
      this.logger.warn(
        'SubagentsRunTaskTool: toolSets not configured — subagent will run without tools',
      );
    } else {
      for (const toolId of definition.toolIds) {
        const toolSet = config.toolSets.get(toolId);
        if (toolSet) {
          tools.push(...toolSet);
        } else {
          this.logger.warn(
            `SubagentsRunTaskTool: toolSet "${toolId}" not found in toolSets map — skipping`,
          );
        }
      }
    }

    const parentModel = this.getParentAgentModel(runnableConfig);
    const model = definition.model({
      parentModel,
      llmModelsService: this.llmModelsService,
    });

    // Build prompt context with workspace information
    const gitRepoPath = config.runtimeProvider
      ? await this.discoverGitRepoPath(config.runtimeProvider, runnableConfig)
      : undefined;

    const promptContext: SubagentPromptContext = {
      gitRepoPath,
      resourcesInformation: config.resourcesInformation,
    };
    const systemPrompt = definition.systemPrompt(promptContext);

    // Create fresh SubAgent instance per invocation.
    // strict: false — SubAgent is registered in AgentsModule, not AgentToolsModule.
    const subAgent = await this.moduleRef.resolve(SubAgent, undefined, {
      strict: false,
    });
    subAgent.setConfig({
      instructions: systemPrompt,
      invokeModelName: model,
      maxIterations: definition.maxIterations,
      ...(definition.maxContextTokens !== undefined
        ? { maxContextTokens: definition.maxContextTokens }
        : {}),
    });
    for (const tool of tools) {
      subAgent.addTool(tool);
    }

    return { subAgent };
  }

  private buildResult(
    loopResult: SubagentRunResult,
    title: string,
  ): ToolInvokeResult<SubagentsRunTaskToolOutput> {
    return {
      output: {
        result: loopResult.result,
        statistics: loopResult.statistics,
        ...(loopResult.error ? { error: loopResult.error } : {}),
      },
      messageMetadata: { __title: title },
      toolRequestUsage: loopResult.statistics.usage ?? undefined,
    };
  }

  private getParentAgentModel(
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): string {
    const callerAgent = runnableConfig.configurable?.caller_agent;
    if (callerAgent) {
      const agentConfig = callerAgent.getConfig() as Record<string, unknown>;
      if (
        agentConfig &&
        typeof agentConfig.invokeModelName === 'string' &&
        agentConfig.invokeModelName.length > 0
      ) {
        return agentConfig.invokeModelName;
      }
    }
    return environment.llmLargeModel;
  }

  /**
   * Auto-detect the git repository under the runtime workspace.
   * Returns the repo root path or undefined if none is found.
   */
  private async discoverGitRepoPath(
    runtimeProvider: RuntimeThreadProvider,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | undefined> {
    try {
      const runtime = await runtimeProvider.provide(cfg);
      const res = await execRuntimeWithContext(
        runtime,
        {
          cmd: `find ${BASE_RUNTIME_WORKDIR} -maxdepth 2 -name .git -type d 2>/dev/null | head -1`,
        },
        cfg,
      );
      if (res.exitCode !== 0) return undefined;
      const gitDir = res.stdout.trim();
      if (!gitDir) return undefined;
      const repoRoot = gitDir.replace(/\/\.git$/, '');
      return repoRoot.length ? repoRoot : undefined;
    } catch {
      return undefined;
    }
  }
}
