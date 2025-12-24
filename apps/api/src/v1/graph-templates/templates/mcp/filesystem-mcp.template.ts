import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import {
  FilesystemMcp,
  FilesystemMcpConfig,
} from '../../../agent-mcp/services/mcp/filesystem-mcp';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  McpNodeBaseTemplate,
  NodeBaseTemplateMetadata,
} from '../base-node.template';

export const FilesystemMcpTemplateSchema = z.object({});

export type FilesystemMcpTemplateSchemaType = z.infer<
  typeof FilesystemMcpTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class FilesystemMcpTemplate extends McpNodeBaseTemplate<
  typeof FilesystemMcpTemplateSchema,
  BaseMcp<FilesystemMcpConfig>
> {
  readonly id = 'filesystem-mcp';
  readonly name = 'Filesystem MCP';
  readonly description = 'File system access via MCP running in Docker runtime';
  readonly schema = FilesystemMcpTemplateSchema;

  readonly inputs = [
    { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
  ] as const;

  readonly outputs = [
    { type: 'kind', value: NodeKind.Runtime, required: true, multiple: false },
  ] as const;

  constructor(
    private readonly filesystemMcp: FilesystemMcp,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: FilesystemMcpTemplateSchemaType,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<BaseMcp<FilesystemMcpConfig>> {
    // Find connected Runtime
    const runtimeNodeId = Array.from(outputNodeIds).find((nodeId) => {
      const node = this.graphRegistry.getNode(metadata.graphId, nodeId);
      return node?.type === NodeKind.Runtime;
    });

    if (!runtimeNodeId) {
      throw new Error('Filesystem MCP requires a Docker Runtime connection');
    }

    const runtimeNode = this.graphRegistry.getNode<DockerRuntime>(
      metadata.graphId,
      runtimeNodeId,
    );

    if (!runtimeNode?.instance) {
      throw new Error(`Runtime instance not found for node ${runtimeNodeId}`);
    }

    // Setup MCP service with runtime
    const graphId = metadata.graphId;

    await this.filesystemMcp.setup(config, () => {
      // Get fresh runtime instance from registry on each invocation
      const currentRuntimeNode = this.graphRegistry.getNode<BaseRuntime>(
        graphId,
        runtimeNodeId,
      );

      if (!currentRuntimeNode?.instance) {
        throw new NotFoundException(
          'RUNTIME_NOT_FOUND',
          `Runtime node ${runtimeNodeId} not found in graph ${graphId}`,
        );
      }

      return currentRuntimeNode.instance;
    });

    return this.filesystemMcp;
  }
}
