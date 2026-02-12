import { Injectable } from '@nestjs/common';
import dedent from 'dedent';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { SubagentsToolGroupConfig } from './subagents.types';
import { SubagentsListTool } from './subagents-list.tool';
import { SubagentsRunTaskTool } from './subagents-run-task.tool';

@Injectable()
export class SubagentsToolGroup extends BaseToolGroup<SubagentsToolGroupConfig> {
  constructor(
    private readonly subagentsListTool: SubagentsListTool,
    private readonly subagentsRunTaskTool: SubagentsRunTaskTool,
  ) {
    super();
  }

  protected buildToolsInternal(
    config: SubagentsToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    return [
      this.subagentsListTool.build(config, lgConfig),
      this.subagentsRunTaskTool.build(config, lgConfig),
    ];
  }

  public getDetailedInstructions(): string {
    return dedent`
      ### Subagents Overview
      Subagents are lightweight autonomous agents you can spawn to perform self-contained tasks.
      Each subagent type has different capabilities (tools) and specializations.

      ### Workflow
      1. Call \`subagents_list\` to see all available subagent types and their capabilities.
      2. Choose the best subagent for your task based on the descriptions.
      3. Call \`subagents_run_task\` with the chosen agent ID and a detailed task description.

      ### Choosing the Right Subagent
      - For read-only exploration, research, and codebase investigation: use "system:explorer"
      - For tasks requiring file modifications, running builds/tests, or general work: use "system:simple"

      ### Best Practices
      - Prefer "explorer" for investigation tasks — it is safer and has read-only constraints.
      - Use "fast" intelligence (default) for simple exploration. Use "smart" only for complex reasoning.
      - Write self-contained task descriptions — subagents cannot ask follow-up questions.
      - Include all necessary file paths, context, and expected output format in the task.
      - Do not delegate tasks you can do faster with a single tool call.
    `;
  }
}
