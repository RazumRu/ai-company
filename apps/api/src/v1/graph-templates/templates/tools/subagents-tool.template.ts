import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { FilesToolGroup } from '../../../agent-tools/tools/common/files/files-tool-group';
import { ShellTool } from '../../../agent-tools/tools/common/shell.tool';
import { SubagentsToolGroup } from '../../../agent-tools/tools/common/subagents/subagents-tool-group';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { SubagentToolId } from '../../../subagents/subagents.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const SubagentsToolTemplateSchema = z
  .object({
    smartModel: z
      .string()
      .optional()
      .describe(
        'Override model for "smart" intelligence mode. If not set, the parent agent\'s model is used.',
      )
      .meta({ 'x-ui:litellm-models-list-select': true }),
  })
  .strip();

@Injectable()
@RegisterTemplate()
export class SubagentsToolTemplate extends ToolNodeBaseTemplate<
  typeof SubagentsToolTemplateSchema
> {
  readonly id = 'subagents-tool';
  readonly name = 'Subagents';
  readonly description =
    'Spawn lightweight subagents to perform autonomous tasks';
  readonly schema = SubagentsToolTemplateSchema;

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
    private readonly subagentsToolGroup: SubagentsToolGroup,
    private readonly shellTool: ShellTool,
    private readonly filesToolGroup: FilesToolGroup,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<z.infer<typeof SubagentsToolTemplateSchema>>,
      ) => ({
        tools: [] as BuiltAgentTool[],
        instructions: undefined as string | undefined,
      }),

      configure: async (
        params: GraphNode<z.infer<typeof SubagentsToolTemplateSchema>>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;
        const config = params.config;

        // Resolve runtime node
        const runtimeNodeIds = this.graphRegistry.filterNodesByType(
          graphId,
          outputNodeIds,
          NodeKind.Runtime,
        );

        if (runtimeNodeIds.length === 0) {
          throw new NotFoundException(
            'NODE_NOT_FOUND',
            'Runtime node not found in output nodes',
          );
        }

        const runtimeNodeId = runtimeNodeIds[0]!;
        const runtimeNode = this.graphRegistry.getNode<RuntimeThreadProvider>(
          graphId,
          runtimeNodeId,
        );

        if (!runtimeNode) {
          throw new NotFoundException(
            'NODE_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found`,
          );
        }

        // Build tool sets for each SubagentToolId
        const toolSets = new Map<string, BuiltAgentTool[]>();

        // Shell tool (full access)
        const shellBuilt = this.shellTool.build({
          runtimeProvider: runtimeNode.instance,
        });
        toolSets.set(SubagentToolId.Shell, [shellBuilt]);

        // Shell tool (read-only — same tool, restrictions enforced via system prompt)
        toolSets.set(SubagentToolId.ShellReadOnly, [shellBuilt]);

        // Files read-only
        const filesReadOnly = this.filesToolGroup.buildTools({
          runtimeProvider: runtimeNode.instance,
          includeEditActions: false,
        });
        toolSets.set(SubagentToolId.FilesReadOnly, filesReadOnly.tools);

        // Files full
        const filesFull = this.filesToolGroup.buildTools({
          runtimeProvider: runtimeNode.instance,
          includeEditActions: true,
        });
        toolSets.set(SubagentToolId.FilesFull, filesFull.tools);

        // Build the subagents tool group
        const { tools, instructions } = this.subagentsToolGroup.buildTools({
          toolSets,
          smartModelOverride: config.smartModel,
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
