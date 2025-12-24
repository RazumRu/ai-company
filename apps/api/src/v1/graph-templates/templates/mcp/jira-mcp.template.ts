import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { JiraMcp } from '../../../agent-mcp/services/mcp/jira-mcp';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  McpNodeBaseTemplate,
  NodeBaseTemplateMetadata,
} from '../base-node.template';

export const JiraMcpTemplateSchema = z.object({
  name: z.string().min(1).default('jira'),
  jiraApiKey: z.string().min(1).describe('Jira API key'),
  jiraEmail: z.string().email().describe('Jira account email'),
  projectKey: z.string().optional().describe('Optional project key filter'),
});

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
    private readonly jiraMcp: JiraMcp,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: JiraMcpTemplateSchemaType,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<BaseMcp> {
    // Find connected Runtime
    const runtimeNodeId = Array.from(outputNodeIds).find((nodeId) => {
      const node = this.graphRegistry.getNode(metadata.graphId, nodeId);
      return node?.type === NodeKind.Runtime;
    });

    if (!runtimeNodeId) {
      throw new Error('Jira MCP requires a Docker Runtime connection');
    }

    const runtimeNode = this.graphRegistry.getNode<DockerRuntime>(
      metadata.graphId,
      runtimeNodeId,
    );

    if (!runtimeNode?.instance) {
      throw new Error(`Runtime instance not found for node ${runtimeNodeId}`);
    }

    // Setup MCP service with runtime
    await this.jiraMcp.setup(config, runtimeNode.instance);

    return this.jiraMcp;
  }
}
