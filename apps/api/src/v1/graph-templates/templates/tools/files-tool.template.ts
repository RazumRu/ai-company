import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { FilesToolGroup } from '../../../agent-tools/tools/common/files/files-tool-group';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const FilesToolTemplateSchema = z
  .object({
    includeEditActions: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Whether to include edit actions (files_apply_changes, files_delete). If false, only read/search tools are included.',
      )
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Edit mode' }),
    fastModel: z
      .string()
      .describe('Model to use for fast/efficient LLM parsing in files_edit.')
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Fast Model' })
      .meta({ 'x-ui:litellm-models-list-select': true }),
    smartModel: z
      .string()
      .describe(
        'Model to use for smart/capable LLM parsing in files_edit_reapply.',
      )
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Smart Model' })
      .meta({ 'x-ui:litellm-models-list-select': true }),
  })
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

@Injectable()
@RegisterTemplate()
export class FilesToolTemplate extends ToolNodeBaseTemplate<
  typeof FilesToolTemplateSchema
> {
  readonly id = 'files-tool';
  readonly name = 'Files Tools';
  readonly description = 'Tools for working with files in repositories';
  readonly schema = FilesToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.Runtime,
      required: true,
      multiple: false,
    },
  ] as const;

  constructor(
    private readonly filesToolGroup: FilesToolGroup,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<z.infer<typeof FilesToolTemplateSchema>>,
      ) => {
        return { tools: [] };
      },
      configure: async (
        params: GraphNode<z.infer<typeof FilesToolTemplateSchema>>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;
        const config = params.config;

        const runtimeNodeIds = this.graphRegistry.filterNodesByType(
          graphId,
          outputNodeIds,
          NodeKind.Runtime,
        );

        if (runtimeNodeIds.length === 0) {
          throw new NotFoundException(
            'NODE_NOT_FOUND',
            `Runtime node not found in output nodes`,
          );
        }

        const runtimeNodeId = runtimeNodeIds[0]!;

        // Validate that the runtime exists in the registry immediately during configuration
        const runtime = this.graphRegistry.getNodeInstance<BaseRuntime>(
          graphId,
          runtimeNodeId,
        );
        if (!runtime) {
          throw new NotFoundException(
            'RUNTIME_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found in graph ${graphId}`,
          );
        }

        const { tools, instructions } = this.filesToolGroup.buildTools({
          runtime,
          includeEditActions: config.includeEditActions,
          fastModel: config.fastModel,
          smartModel: config.smartModel,
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
