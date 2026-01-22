import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { KnowledgeToolGroup } from '../../../agent-tools/tools/common/knowledge/knowledge-tool-group';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const KnowledgeToolsTemplateSchema = z
  .object({
    tags: z
      .array(z.string().min(1))
      .optional()
      .meta({ 'x-ui:label': 'Tags' })
      .describe('Optional tags to filter knowledge search results.'),
  })
  .strip();

export type KnowledgeToolsTemplateSchemaType = z.infer<
  typeof KnowledgeToolsTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class KnowledgeToolsTemplate extends ToolNodeBaseTemplate<
  typeof KnowledgeToolsTemplateSchema
> {
  readonly id = 'knowledge-tools';
  readonly name = 'Knowledge Tools';
  readonly description =
    'Tools to locate knowledge documents and retrieve its content.';
  readonly schema = KnowledgeToolsTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [] as const;

  constructor(private readonly knowledgeToolGroup: KnowledgeToolGroup) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<KnowledgeToolsTemplateSchemaType>,
      ): Promise<{ tools: BuiltAgentTool[]; instructions?: string }> => {
        return { tools: [] };
      },
      configure: async (
        params: GraphNode<KnowledgeToolsTemplateSchemaType>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const normalizedConfig = this.normalizeConfig(params.config);
        const { tools, instructions } = this.knowledgeToolGroup.buildTools({
          tags: normalizedConfig.tags,
        });

        instance.tools.length = 0;
        instance.tools.push(...tools);
        instance.instructions = instructions;
      },
      destroy: async (instance: { tools: BuiltAgentTool[] }) => {
        instance.tools.length = 0;
      },
    };
  }

  private normalizeConfig(
    config: KnowledgeToolsTemplateSchemaType,
  ): KnowledgeToolsTemplateSchemaType {
    return {
      ...config,
      tags: config.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    };
  }
}
