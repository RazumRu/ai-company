import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { JiraMcp } from '../../../agent-mcp/services/mcp/jira-mcp';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { McpNodeBaseTemplate } from '../base-node.template';

export const JiraMcpTemplateSchema = z
  .object({
    name: z.string().min(1).default('jira'),
    jiraUrl: z
      .url()
      .describe('Jira base URL (e.g. https://your-domain.atlassian.net)'),
    jiraApiKey: z.string().min(1).describe('Jira API key'),
    jiraEmail: z.string().email().describe('Jira account email'),
    projectKey: z.string().optional().describe('Optional project key filter'),
  })
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

export type JiraMcpTemplateSchemaType = z.infer<typeof JiraMcpTemplateSchema>;

@Injectable()
@RegisterTemplate()
export class JiraMcpTemplate extends McpNodeBaseTemplate<
  typeof JiraMcpTemplateSchema,
  BaseMcp
> {
  readonly id = 'jira-mcp';
  readonly name = 'Jira MCP';
  readonly description =
    'Jira integration via remote MCP running in Docker runtime';
  readonly schema = JiraMcpTemplateSchema;

  readonly inputs = [
    { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
  ] as const;

  readonly outputs = [
    { type: 'kind', value: NodeKind.Runtime, required: true, multiple: false },
  ] as const;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (_params: GraphNode<JiraMcpTemplateSchemaType>) =>
        this.createNewInstance(this.moduleRef, JiraMcp),
      configure: async (
        params: GraphNode<JiraMcpTemplateSchemaType>,
        instance: JiraMcp,
      ) => {
        const graphId = params.metadata.graphId;
        const outputNodeIds = params.outputNodeIds;
        const config = params.config;

        const runtimeNodeId = Array.from(outputNodeIds).find((nodeId) => {
          const node = this.graphRegistry.getNode(graphId, nodeId);
          return node?.type === NodeKind.Runtime;
        });

        if (!runtimeNodeId) {
          throw new Error('Jira MCP requires a Docker Runtime connection');
        }

        // Validate that runtime exists immediately during configuration
        const runtime = this.graphRegistry.getNodeInstance<DockerRuntime>(
          graphId,
          runtimeNodeId,
        );
        if (!runtime) {
          throw new Error(
            `Runtime instance not found for node ${runtimeNodeId}`,
          );
        }

        // Reconfigure: cleanup then setup again
        await instance.cleanup().catch(() => {});

        await instance.setup(config, runtime);
      },
      destroy: async (instance: JiraMcp) => {
        await instance.cleanup().catch(() => {});
      },
    };
  }
}
