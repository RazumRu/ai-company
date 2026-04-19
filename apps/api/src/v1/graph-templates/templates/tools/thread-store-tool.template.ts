import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { ThreadStoreToolGroup } from '../../../agent-tools/tools/common/thread-store/thread-store-tool-group';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const ThreadStoreToolTemplateSchema = z
  .object({
    readOnly: z
      .boolean()
      .optional()
      .describe(
        'When true, only expose thread_store_get and thread_store_list; writes are disabled.',
      )
      .meta({ 'x-ui:label': 'Read-only' }),
  })
  .strip();

export type ThreadStoreToolTemplateSchemaType = z.infer<
  typeof ThreadStoreToolTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class ThreadStoreToolTemplate extends ToolNodeBaseTemplate<
  typeof ThreadStoreToolTemplateSchema
> {
  readonly id = 'thread-store-tool';
  readonly name = 'Thread Store';
  readonly description =
    'Shared per-thread key-value + append log. All agents on the same thread (parent + subagents) can read and write it.';
  readonly schema = ThreadStoreToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [] as const;

  constructor(private readonly threadStoreToolGroup: ThreadStoreToolGroup) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<ThreadStoreToolTemplateSchemaType>,
      ): Promise<{ tools: BuiltAgentTool[]; instructions?: string }> => {
        return { tools: [] };
      },
      configure: async (
        params: GraphNode<ThreadStoreToolTemplateSchemaType>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const { tools, instructions } = this.threadStoreToolGroup.buildTools({
          readOnly: params.config.readOnly,
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
}
