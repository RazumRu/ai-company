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
  public description = `Signal task completion or request strictly necessary info. Always call this tool to end your turn. Set needsMoreInfo=false when done. Set needsMoreInfo=true only if a specific required input is missing and you cannot proceed; do not ask open-ended or speculative questions. If you can proceed using context or reasonable defaults, do so and state assumptions in message. If you must ask, send one concise, structured request listing the exact fields and acceptable formats. This is the only way to end your response.`;
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
