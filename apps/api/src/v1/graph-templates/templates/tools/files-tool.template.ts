import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import { FilesToolGroup } from '../../../agent-tools/tools/common/files/files-tool-group';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const FilesToolTemplateSchema = z.object({}).strict();

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

  async create(
    config: z.infer<typeof FilesToolTemplateSchema>,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool[]> {
    // Find runtime node from output nodes
    const runtimeNodeIds = this.graphRegistry.filterNodesByType(
      metadata.graphId,
      outputNodeIds,
      NodeKind.Runtime,
    );

    if (runtimeNodeIds.length === 0) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node not found in output nodes`,
      );
    }

    const runtimeNode = this.graphRegistry.getNode<BaseRuntime>(
      metadata.graphId,
      runtimeNodeIds[0]!,
    );

    if (!runtimeNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Runtime node ${runtimeNodeIds[0]} not found`,
      );
    }

    // Store the runtime node ID to fetch fresh instance on each invocation
    const runtimeNodeId = runtimeNodeIds[0]!;
    const graphId = metadata.graphId;

    return this.filesToolGroup.buildTools({
      runtime: () => {
        // Get fresh runtime instance from registry on each invocation
        const currentRuntimeNode = this.graphRegistry.getNode<BaseRuntime>(
          graphId,
          runtimeNodeId,
        );

        if (!currentRuntimeNode) {
          throw new NotFoundException(
            'RUNTIME_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found in graph ${graphId}`,
          );
        }

        return currentRuntimeNode.instance;
      },
    });
  }
}
