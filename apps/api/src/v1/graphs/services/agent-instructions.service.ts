import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { OpenaiService } from '../../openai/openai.service';
import { GraphDao } from '../dao/graph.dao';
import {
  SuggestAgentInstructionsDto,
  SuggestAgentInstructionsResponse,
} from '../dto/agent-instructions.dto';
import { CompiledGraph, NodeKind } from '../graphs.types';
import { GraphRegistry } from './graph-registry';

type ConnectedToolInfo = {
  name: string;
  description: string;
  instructions?: string;
};

@Injectable()
export class AgentInstructionsService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly graphRegistry: GraphRegistry,
    private readonly templateRegistry: TemplateRegistry,
    private readonly authContext: AuthContextService,
    private readonly openaiService: OpenaiService,
  ) {}

  async suggest(
    graphId: string,
    nodeId: string,
    payload: SuggestAgentInstructionsDto,
  ): Promise<SuggestAgentInstructionsResponse> {
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const node = graph.schema.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new NotFoundException('NODE_NOT_FOUND');
    }

    const template = this.templateRegistry.getTemplate(node.template);
    if (!template || template.kind !== NodeKind.SimpleAgent) {
      throw new BadRequestException(
        'INVALID_NODE_TYPE',
        'Instruction suggestions are only available for agent nodes',
      );
    }

    const compiledGraph = this.graphRegistry.get(graphId);
    if (!compiledGraph) {
      throw new BadRequestException(
        'GRAPH_NOT_RUNNING',
        'Graph must be running to suggest instructions',
      );
    }

    const currentInstructions = this.getCurrentInstructions(node.config);
    const tools = this.getConnectedTools(
      graphId,
      nodeId,
      compiledGraph?.edges || graph.schema.edges,
      compiledGraph,
    );

    const threadId = payload.threadId;

    const response = await this.openaiService.response(
      {
        systemMessage: this.buildSystemPrompt(),
        message: this.buildRequestPrompt(
          payload.userRequest,
          currentInstructions,
          tools,
        ),
      },
      {
        model: 'gpt-5.1',
        reasoning: { effort: 'high' },
        previous_response_id: threadId,
      },
    );

    const updated = response.content?.trim();

    return {
      instructions: updated?.length ? updated : currentInstructions,
      threadId: response.conversationId,
    };
  }

  private getCurrentInstructions(config: unknown): string {
    const instructions = (config as { instructions?: unknown })?.instructions;

    if (typeof instructions !== 'string' || !instructions.trim()) {
      throw new BadRequestException(
        'INVALID_AGENT_CONFIG',
        'Agent node instructions are not configured',
      );
    }

    return instructions;
  }

  private getConnectedTools(
    graphId: string,
    nodeId: string,
    edges: { from: string; to: string }[] | undefined,
    compiledGraph?: CompiledGraph,
  ): ConnectedToolInfo[] {
    if (!compiledGraph) {
      return [];
    }

    const outgoingNodeIds = new Set(
      (edges || [])
        .filter((edge) => edge.from === nodeId)
        .map((edge) => edge.to),
    );

    if (!outgoingNodeIds.size) {
      return [];
    }

    const toolNodeIds = this.graphRegistry.filterNodesByType(
      graphId,
      outgoingNodeIds,
      NodeKind.Tool,
    );

    return toolNodeIds.flatMap((toolNodeId) => {
      const toolNode = this.graphRegistry.getNode<
        BuiltAgentTool | BuiltAgentTool[]
      >(graphId, toolNodeId);

      if (!toolNode || toolNode.type !== NodeKind.Tool) {
        return [];
      }

      const tools = Array.isArray(toolNode.instance)
        ? toolNode.instance
        : [toolNode.instance];

      return tools.map(
        (tool): ConnectedToolInfo => ({
          name: tool.name,
          description: tool.description,
          instructions: tool.__instructions,
        }),
      );
    });
  }

  private buildSystemPrompt(): string {
    return [
      'You rewrite agent system instructions.',
      'Use the current instructions as a base and apply the user request.',
      'You can analyze connected tool capabilities and their usage guidelines. But dont duplicate Connected tools information, it will be automatically injected to instructions. So you can just refer to it if needed.',
      'Keep the result concise, actionable, and focused on how the agent should behave.',
      'Return only the updated instructions text without extra commentary.',
    ].join('\n');
  }

  private buildRequestPrompt(
    userRequest: string,
    currentInstructions: string,
    tools: ConnectedToolInfo[],
  ): string {
    const toolsSection = tools.length
      ? tools
          .map((tool) => {
            const details = [
              `Name: ${tool.name}`,
              `Description: ${tool.description}`,
            ];

            if (tool.instructions) {
              details.push(`Instructions:\n${tool.instructions}`);
            }

            return details.join('\n');
          })
          .join('\n\n')
      : 'No connected tools available.';

    return [
      `User request:\n${userRequest}`,
      `Current instructions:\n${currentInstructions}`,
      `Connected tools:\n${toolsSection}`,
      'Provide the full updated instructions. Do not include a preamble.',
    ].join('\n\n');
  }
}
