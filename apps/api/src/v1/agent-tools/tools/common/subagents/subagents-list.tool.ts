import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { SubagentsService } from '../../../../subagents/subagents.service';
import { BaseTool, ToolInvokeResult } from '../../base-tool';
import { SubagentsToolGroupConfig } from './subagents.types';

export const SubagentsListToolSchema = z.object({});

export type SubagentsListToolSchemaType = z.infer<
  typeof SubagentsListToolSchema
>;

export interface SubagentsListToolOutput {
  agents: { id: string; description: string }[];
}

@Injectable()
export class SubagentsListTool extends BaseTool<
  SubagentsListToolSchemaType,
  SubagentsToolGroupConfig,
  SubagentsListToolOutput
> {
  public name = 'subagents_list';
  public description =
    'List all available subagent types with their IDs and descriptions. ' +
    'Call this first to see which specialized subagents are available, then use ' +
    'subagents_run_task with the chosen agent ID. Returns an array of agent definitions.';

  constructor(private readonly subagentsService: SubagentsService) {
    super();
  }

  public get schema() {
    return SubagentsListToolSchema;
  }

  protected override generateTitle(): string {
    return 'List subagents';
  }

  public async invoke(
    _args: SubagentsListToolSchemaType,
    _config: SubagentsToolGroupConfig,
    _runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<SubagentsListToolOutput>> {
    const agents = this.subagentsService.getAllSystem().map((d) => ({
      id: d.id,
      description: d.description,
    }));

    return {
      output: { agents },
      messageMetadata: { __title: 'List subagents' },
    };
  }
}
