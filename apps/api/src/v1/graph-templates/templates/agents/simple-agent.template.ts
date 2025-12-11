import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IBaseKnowledgeOutput } from '../../../agent-knowledge/agent-knowledge.types';
import { SimpleKnowledge } from '../../../agent-knowledge/services/simple-knowledge';
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
    for (const nodeId of outputNodeIds) {
      const node = this.graphRegistry.getNode<
        | BuiltAgentTool
        | BuiltAgentTool[]
        | DynamicStructuredTool
        | DynamicStructuredTool[]
        | SimpleKnowledge
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
      }
    }

    // Collect detailed instructions from all connected tools
    const toolInstructions = this.collectToolInstructions(allTools);

    const knowledgeInstructions =
      this.collectKnowledgeInstructions(knowledgeBlocks);

    // Build enhanced instructions with tool usage guidance
    const enhancedInstructions = [
      config.instructions,
      knowledgeInstructions,
      toolInstructions,
    ]
      .filter(Boolean)
      .join('\n\n');

    // Set configuration with enhanced instructions
    const agentConfig = {
      ...config,
      instructions: enhancedInstructions,
    };

    agent.setConfig(agentConfig);

    return agent;
  }

  private collectToolInstructions(tools: BuiltAgentTool[]): string | undefined {
    const blocks = tools
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

    const blocks = knowledgeBlocks.map(({ id, content }) => `${content}`);

    return ['## Knowledge', ...blocks].join('\n\n');
  }
}
