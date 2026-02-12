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
import { SubagentsService } from '../../../../subagents/subagents.service';
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
        '"system:simple" (general-purpose with full shell and file access).',
    ),
  task: z
    .string()
    .min(1)
    .describe(
      'A clear, self-contained description of the task to delegate. Include all context needed: ' +
        'file paths, specific questions, constraints, expected output format. The subagent cannot ' +
        'ask follow-up questions — it must be able to complete the task from this description alone.',
    ),
  intelligence: z
    .enum(['smart', 'fast'])
    .default('fast')
    .describe(
      'Intelligence level for the subagent. "smart" uses the same large model as the parent agent ' +
        '(higher quality, more expensive). "fast" uses a smaller coding model ' +
        '(cheaper, faster, good for simple exploration and small tasks). Default: "fast".',
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
    'The subagent has its own context window and runs in the same runtime environment. ' +
    'Choose the right agent type via agentId (use subagents_list to see options). ' +
    'Returns the result along with token usage statistics.';

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
    return `Subagent (${args.agentId}): ${args.purpose}`;
  }

  public getDetailedInstructions(
    _config: SubagentsToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Spawns a lightweight subagent with its own context window to perform a self-contained task.
      The subagent runs autonomously in the same runtime environment and returns a result.

      ### When to Use
      - Exploring unfamiliar parts of the codebase (use "system:explorer")
      - Performing focused research tasks (use "system:explorer")
      - Making small, well-defined code changes (use "system:simple")
      - Running commands and analyzing their output (use "system:simple")
      - Any task that can be fully described in a single instruction

      ### When NOT to Use
      - Tasks requiring back-and-forth clarification — subagents cannot ask questions
      - Tasks you can do faster with a single tool call (e.g., reading one file)
      - Long-running tasks that need many iterations — use direct tools instead

      ### Intelligence Levels
      - **"fast"** (default): Smaller, cheaper coding model. Best for exploration, searches, simple tasks.
      - **"smart"**: Same large model as you. Best for complex reasoning, nuanced changes, architectural analysis.

      ### Writing Good Task Descriptions
      **Good — specific and self-contained:**
      \`\`\`json
      {"agentId": "system:explorer", "task": "Find all files in /runtime-workspace/my-repo/src that import from '@auth' and list their paths with the specific import statements.", "intelligence": "fast", "purpose": "Map auth dependencies"}
      \`\`\`

      \`\`\`json
      {"agentId": "system:simple", "task": "In /runtime-workspace/my-repo/src/utils/validators.ts, add a new export function 'isValidEmail(email: string): boolean' that validates email format using a regex. Follow the same style as existing validator functions in the file.", "intelligence": "smart", "purpose": "Add email validator"}
      \`\`\`

      **Bad — vague or missing context:**
      \`\`\`json
      {"agentId": "system:simple", "task": "Fix the bug", "intelligence": "fast", "purpose": "Fix bug"}
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
      args,
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
      args,
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
    definition: { systemPrompt: string; toolIds: string[] },
    args: SubagentsRunTaskToolSchemaType,
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

    const model = this.selectModel(args.intelligence, config, runnableConfig);
    const systemPrompt = this.buildSystemPrompt(
      definition.systemPrompt,
      config.resourcesInformation,
    );

    // Create fresh SubAgent instance per invocation.
    // strict: false — SubAgent is registered in AgentsModule, not AgentToolsModule.
    const subAgent = await this.moduleRef.resolve(SubAgent, undefined, {
      strict: false,
    });
    subAgent.setConfig({ instructions: systemPrompt, invokeModelName: model });
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

  private selectModel(
    intelligence: 'smart' | 'fast',
    config: SubagentsToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): string {
    if (intelligence === 'smart') {
      return (
        config.smartModelOverride || this.getParentAgentModel(runnableConfig)
      );
    }
    return this.llmModelsService.getSubagentFastModel();
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

  private buildSystemPrompt(
    basePrompt: string,
    resourcesInformation?: string,
  ): string {
    if (!resourcesInformation) return basePrompt;
    return `${basePrompt}\n\nAdditional workspace information:\n${resourcesInformation}`;
  }
}
