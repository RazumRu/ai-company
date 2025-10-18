import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { BaseTool } from './base-tool';

export class FinishToolResponse {
  constructor(public message?: string) {}
}

export const FinishToolSchema = z.object({ message: z.string().optional() });
export type FinishToolSchemaType = z.infer<typeof FinishToolSchema>;

@Injectable()
export class FinishTool extends BaseTool<FinishToolSchemaType> {
  public name = 'finish';
  public description =
    'Signal the current task is complete. Call this before ending when output is restricted.';
  public system = true;

  public get schema() {
    return FinishToolSchema;
  }

  public invoke(
    args: FinishToolSchemaType,
    _config: Record<PropertyKey, any>,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    return new FinishToolResponse(args.message);
  }
}
