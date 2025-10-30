import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { BaseTool } from './base-tool';

export class FinishToolResponse {
  constructor(
    public message: string,
    public needsMoreInfo: boolean = false,
  ) {}
}

export const FinishToolSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  message: z
    .string()
    .min(1)
    .describe('Description of what was accomplished or the result of the task'),
  needsMoreInfo: z
    .boolean()
    .default(false)
    .describe(
      'Set to true if you need more information from the user. Include your question in the message field.',
    ),
});
export type FinishToolSchemaType = z.infer<typeof FinishToolSchema>;

@Injectable()
export class FinishTool extends BaseTool<FinishToolSchemaType> {
  public name = 'finish';
  public description =
    'Signal the current task is complete or that you need more information from the user. ALWAYS call this tool before ending your response. If you have completed the task, set needsMoreInfo to false. If you need more information from the user, set needsMoreInfo to true and include your question in the message field. This is the ONLY way to end your response.';
  public system = true;

  public get schema() {
    return FinishToolSchema;
  }

  public invoke(
    args: FinishToolSchemaType,
    _config: Record<PropertyKey, unknown>,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    return new FinishToolResponse(args.message, args.needsMoreInfo);
  }
}
