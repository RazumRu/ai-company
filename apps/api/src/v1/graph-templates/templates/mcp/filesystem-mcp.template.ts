import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import {
  FilesystemMcp,
  FilesystemMcpConfig,
} from '../../../agent-mcp/services/mcp/filesystem-mcp';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import {
  RuntimeStartParams,
  RuntimeType,
} from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { McpNodeBaseTemplate } from '../base-node.template';

export const FilesystemMcpTemplateSchema = z
  .object({
    readOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, only read-only filesystem tools are exposed (no write/edit/move/create).',
      )
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Read-only mode' }),
  })
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

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
    private readonly moduleRef: ModuleRef,
    private readonly graphRegistry: GraphRegistry,
    private readonly runtimeProvider: RuntimeProvider,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (_params: GraphNode<FilesystemMcpTemplateSchemaType>) =>
        this.createNewInstance(this.moduleRef, FilesystemMcp),
      configure: async (
        params: GraphNode<FilesystemMcpTemplateSchemaType>,
        instance: FilesystemMcp,
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;
        const config = params.config;

        // Find connected Runtime
        const runtimeNodeId = Array.from(outputNodeIds).find((nodeId) => {
          const node = this.graphRegistry.getNode(graphId, nodeId);
          return node?.type === NodeKind.Runtime;
        });

        if (!runtimeNodeId) {
          throw new Error(
            'Filesystem MCP requires a Docker Runtime connection',
          );
        }

        // Reconfigure: best-effort cleanup then setup again
        await instance.cleanup().catch(() => {});

        const runtimeNode = this.graphRegistry.getNode<RuntimeThreadProvider>(
          graphId,
          runtimeNodeId,
        );
        if (!runtimeNode) {
          throw new NotFoundException(
            'RUNTIME_NOT_FOUND',
            `Runtime node ${runtimeNodeId} not found in graph ${graphId}`,
          );
        }

        const runtimeConfig = runtimeNode.config as RuntimeStartParams & {
          runtimeType: RuntimeType;
        };
        const runtime = await instance.provideTemporaryRuntime({
          runtimeProvider: this.runtimeProvider,
          graphId,
          runtimeNodeId,
          runtimeConfig,
        });
        await instance.initialize(
          config,
          runtimeNode.instance,
          runtime,
          params.metadata.nodeId,
        );
      },
      destroy: async (instance: FilesystemMcp) => {
        await instance.cleanup().catch(() => {});
      },
    };
  }
}
