import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { SubAgent } from '../../../../agents/services/agents/sub-agent';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { SubagentsService } from '../../../../subagents/subagents.service';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { SubagentsToolGroupConfig } from './subagents.types';

export const SubagentsRunTaskToolSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .describe(
      'The ID of the subagent to run. Get available IDs from subagents_list. ' +
        'Example values: "explorer" (read-only codebase investigation), ' +
        '"simple" (general-purpose with full shell and file access).',
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
    private readonly subAgent: SubAgent,
    private readonly llmModelsService: LlmModelsService,
    private readonly subagentsService: SubagentsService,
  ) {
    super();
  }

  public get schema() {
    return SubagentsRunTaskToolSchema;
  }

  protected override generateTitle(
    args: SubagentsRunTaskToolSchemaType,
  ): string {
    return `Calling subagent - ${args.purpose}`;
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
      - Exploring unfamiliar parts of the codebase (use "explorer")
      - Performing focused research tasks (use "explorer")
      - Making small, well-defined code changes (use "simple")
      - Running commands and analyzing their output (use "simple")
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
      {"agentId": "explorer", "task": "Find all files in /runtime-workspace/my-repo/src that import from '@auth' and list their paths with the specific import statements.", "intelligence": "fast", "purpose": "Map auth dependencies"}
      \`\`\`

      \`\`\`json
      {"agentId": "simple", "task": "In /runtime-workspace/my-repo/src/utils/validators.ts, add a new export function 'isValidEmail(email: string): boolean' that validates email format using a regex. Follow the same style as existing validator functions in the file.", "intelligence": "smart", "purpose": "Add email validator"}
      \`\`\`

      **Bad — vague or missing context:**
      \`\`\`json
      {"agentId": "simple", "task": "Fix the bug", "intelligence": "fast", "purpose": "Fix bug"}
      \`\`\`
    `;
  }

  public async invoke(
    args: SubagentsRunTaskToolSchemaType,
    config: SubagentsToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<SubagentsRunTaskToolOutput>> {
    const title = this.generateTitle(args);

    const resolved = await this.subagentsService.getById(args.agentId);

    if (!resolved) {
      return {
        output: {
          result: `Unknown agent ID "${args.agentId}"`,
          error: 'Invalid agentId',
        },
        messageMetadata: { __title: title },
      };
    }

    const model = this.selectModel(args.intelligence, config, runnableConfig);
    const systemPrompt = this.buildSystemPrompt(
      resolved.systemPrompt,
      config.resourcesInformation,
    );
    //
    // const loopResult = await this.subAgent.run(
    //   args.task,
    //   { tools: resolved.tools, systemPrompt, model },
    //   runnableConfig,
    // );
    //
    // return {
    //   output: {
    //     result: loopResult.result,
    //     statistics: loopResult.statistics,
    //     ...(loopResult.error ? { error: loopResult.error } : {}),
    //   },
    //   messageMetadata: { __title: title },
    //   toolRequestUsage: loopResult.statistics.usage ?? undefined,
    // };
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
