import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { WebSearchTool } from '../../../agent-tools/tools/common/web-search.tool';
import { CompiledGraphNode as _CompiledGraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const WebSearchToolTemplateSchema = z
  .object({
    apiKey: z.string().min(1).describe('Tavily API key to authorize searches'),
  })
  .strict();

@Injectable()
@RegisterTemplate()
export class WebSearchToolTemplate extends ToolNodeBaseTemplate<
  typeof WebSearchToolTemplateSchema
> {
  readonly id = 'web-search-tool';
  readonly name = 'Web search';
  readonly description = 'Search the web for information';
  readonly schema = WebSearchToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(private readonly webSearchTool: WebSearchTool) {
    super();
  }

  async create(
    config: z.infer<typeof WebSearchToolTemplateSchema>,
    _inputNodeIds: Set<string>,
    _outputNodeIds: Set<string>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<BuiltAgentTool[]> {
    return [this.webSearchTool.build(config)];
  }
}
