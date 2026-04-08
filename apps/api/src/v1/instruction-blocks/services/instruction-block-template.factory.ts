import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { InstructionNodeBaseTemplate } from '../../graph-templates/templates/base-node.template';
import type {
  GraphNode,
  GraphNodeInstanceHandle,
} from '../../graphs/graphs.types';
import { NodeKind } from '../../graphs/graphs.types';
import type { InstructionBlockDefinition } from '../instruction-blocks.types';
import type { InstructionBlocksService } from './instruction-blocks.service';

type InstructionBlockSchemaType = {
  name: string;
  content: string;
  instructionBlockId: string;
  instructionBlockContentHash: string;
};

@Injectable()
export class InstructionBlockTemplateFactory {
  createTemplate(
    def: InstructionBlockDefinition,
    instructionBlocksService: InstructionBlocksService,
  ): InstructionNodeBaseTemplate<z.ZodTypeAny> {
    const schema = z.object({
      name: z
        .string()
        .min(1)
        .describe('Name of this instruction block')
        .default(def.name),
      content: z
        .string()
        .describe('Instruction content provided to connected agents')
        .default(def.instructions),
      instructionBlockId: z.string().default(def.id),
      instructionBlockContentHash: z.string().default(def.contentHash),
    });

    const template = new (class extends InstructionNodeBaseTemplate<
      typeof schema
    > {
      readonly id = def.templateId;
      readonly name = def.name;
      readonly description = def.description;
      readonly schema = schema;
      readonly instructionBlockId = def.id;
      readonly instructionBlockContentHash = def.contentHash;

      readonly inputs = [
        { type: 'kind' as const, value: NodeKind.SimpleAgent, multiple: true },
      ] as const;

      readonly outputs = [] as const;

      async create(): Promise<
        GraphNodeInstanceHandle<string, InstructionBlockSchemaType>
      > {
        return {
          provide: async (params: GraphNode<InstructionBlockSchemaType>) => {
            try {
              const latestDef = instructionBlocksService.getById(def.id);
              return latestDef.instructions;
            } catch {
              return params.config.content;
            }
          },

          configure: async (
            _params: GraphNode<InstructionBlockSchemaType>,
            _instance: string,
          ) => {
            // no-op
          },

          destroy: async (_instance: string) => {
            // no-op
          },
        };
      }
    })();

    return template;
  }
}
