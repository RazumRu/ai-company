import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { InstructionNodeBaseTemplate } from '../base-node.template';

export const CustomInstructionTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .default('Custom Instruction')
    .describe('Name for this instruction block'),
  content: z
    .string()
    .min(1)
    .describe('Instruction text injected into connected agent system prompts')
    .meta({ 'x-ui:textarea': true })
    .meta({ 'x-ui:ai-suggestions': true }),
});

export type CustomInstructionTemplateSchemaType = z.infer<
  typeof CustomInstructionTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class CustomInstructionTemplate extends InstructionNodeBaseTemplate<
  typeof CustomInstructionTemplateSchema
> {
  readonly id = 'custom-instruction';
  readonly name = 'Custom Instruction';
  readonly description =
    'A custom instruction block that injects user-defined text into connected agent system prompts.';
  readonly schema = CustomInstructionTemplateSchema;

  readonly inputs = [
    {
      type: 'kind' as const,
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [] as const;

  constructor() {
    super();
  }

  public async create() {
    return {
      provide: async (
        params: GraphNode<CustomInstructionTemplateSchemaType>,
      ): Promise<string> => params.config.content,
      configure: async (
        _params: GraphNode<CustomInstructionTemplateSchemaType>,
        _instance: string,
      ): Promise<void> => {},
      destroy: async (_instance: string): Promise<void> => {},
    };
  }
}
