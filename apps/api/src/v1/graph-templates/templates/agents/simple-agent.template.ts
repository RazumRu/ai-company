import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IBaseKnowledgeOutput } from '../../../agent-knowledge/agent-knowledge.types';
import { SimpleKnowledge } from '../../../agent-knowledge/services/simple-knowledge';
import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import {
  SimpleAgent,
  SimpleAgentSchema,
} from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  SimpleAgentNodeBaseTemplate,
} from '../base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema;

export type SimpleAgentTemplateSchemaType = z.infer<
  typeof SimpleAgentTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema,
  SimpleAgent
> {
  readonly id = 'simple-agent';
  readonly name = 'Simple agent';
  readonly description =
    'Configurable agent that can use connected tools and triggers';
  readonly schema = SimpleAgentTemplateSchema;

  readonly inputs = [
    {
      type: 'template',
      value: 'agent-communication-tool',
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Trigger,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.Tool,
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Knowledge,
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Mcp,
      multiple: true,
    },
  ] as const;

  constructor(
    private readonly agentFactoryService: AgentFactoryService,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<SimpleAgent> {
    const agent = await this.agentFactoryService.create(SimpleAgent);

    // Collect all tools from connected nodes
    const allTools: BuiltAgentTool[] = [];
    const knowledgeBlocks: { id: string; content: string }[] = [];
    const mcpOutputs: BaseMcp<unknown>[] = [];

    for (const nodeId of outputNodeIds) {
      const node = this.graphRegistry.getNode<
        | BuiltAgentTool
        | BuiltAgentTool[]
        | DynamicStructuredTool
        | DynamicStructuredTool[]
        | SimpleKnowledge
        | BaseMcp<unknown>
      >(metadata.graphId, nodeId);

      if (!node) {
        continue;
      }

      if (node.type === NodeKind.Tool) {
        const tools = Array.isArray(node.instance)
          ? node.instance
          : [node.instance];

        tools.forEach((tool) => {
          const builtTool = tool as BuiltAgentTool;
          allTools.push(builtTool);
          agent.addTool(builtTool);
        });
        continue;
      }

      if (node.type === NodeKind.Knowledge) {
        const content = this.extractKnowledgeContent(node);
        if (content) {
          knowledgeBlocks.push({ id: nodeId, content });
        }
        continue;
      }

      if (node.type === NodeKind.Mcp) {
        const mcpService = node.instance as BaseMcp<unknown>;
        if (mcpService) {
          mcpOutputs.push(mcpService);
        }
      }
    }

    const knowledgeInstructions =
      this.collectKnowledgeInstructions(knowledgeBlocks);

    const mcpInstructions = this.collectMcpInstructions(mcpOutputs);

    agent.setConfig(config);
    agent.setMcpServices(mcpOutputs);
    await agent.initTools(config);

    // After the first build, the agent contains ALL tools (connected + MCP + finish).
    // Now we can generate tool instructions in the same format as regular tools.
    const toolInstructions = this.collectToolInstructions(
      agent.getTools() as BuiltAgentTool[],
    );

    const finalConfig = {
      ...config,
      instructions: [
        config.instructions,
        knowledgeInstructions,
        toolInstructions,
        mcpInstructions,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };

    agent.setConfig(finalConfig);

    return agent;
  }

  private collectToolInstructions(tools: BuiltAgentTool[]): string | undefined {
    const blocks = tools
      .filter((tool): tool is BuiltAgentTool => Boolean(tool))
      .map((tool) => {
        if (!tool.__instructions) {
          return null;
        }

        return `### ${tool.name}\n${tool.__instructions}`;
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## Tool Instructions', ...blocks].join('\n\n');
  }

  private extractKnowledgeContent(node: CompiledGraphNode): string | undefined {
    const content = (node.instance as IBaseKnowledgeOutput)?.content;

    if (typeof content !== 'string') {
      return undefined;
    }

    const trimmed = content.trim();
    return trimmed.length ? trimmed : undefined;
  }

  private collectKnowledgeInstructions(
    knowledgeBlocks: { id: string; content: string }[],
  ): string | undefined {
    if (!knowledgeBlocks.length) {
      return undefined;
    }

    const blocks = knowledgeBlocks.map(({ content }) => `${content}`);

    return ['## Knowledge', ...blocks].join('\n\n');
  }

  private collectMcpInstructions(
    mcpOutputs: BaseMcp<unknown>[],
  ): string | undefined {
    const blocks = mcpOutputs
      .map((mcp) => {
        const instructions = mcp.getDetailedInstructions?.(mcp.config as never);
        return instructions || null;
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## MCP Instructions', ...blocks].join('\n\n');
  }
}
