import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { isPlainObject, isString } from 'lodash';
import type { UnknownRecord } from 'type-fest';

import { IBaseKnowledgeOutput } from '../../agent-knowledge/agent-knowledge.types';
import { SimpleKnowledgeConfig } from '../../agent-knowledge/services/simple-knowledge';
import { BaseMcp } from '../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { MessageDto } from '../../graphs/dto/graphs.dto';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import {
  CompiledGraph,
  GraphEdgeSchemaType,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { OpenaiService } from '../../openai/openai.service';
import { MessagesDao } from '../../threads/dao/messages.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import {
  SuggestAgentInstructionsDto,
  SuggestAgentInstructionsResponse,
} from '../dto/agent-instructions.dto';
import {
  SuggestKnowledgeContentDto,
  SuggestKnowledgeContentResponse,
} from '../dto/knowledge-suggestions.dto';
import {
  ThreadAnalysisRequestDto,
  ThreadAnalysisResponse,
} from '../dto/thread-analysis.dto';

type SanitizedMessage =
  | {
      role: 'human' | 'ai' | 'reasoning' | 'system';
      content: string;
      from: string;
      toolCalls?: {
        name: string;
        args?: Record<string, unknown>;
        type?: string;
      }[];
    }
  | {
      role: 'tool';
      name: string;
      content: string;
      from: string;
      title?: string;
    }
  | {
      role: 'tool-shell';
      name: 'shell';
      exitCode: number;
      stdout?: string;
      stderr?: string;
      from: string;
    };

type AgentContext = {
  nodeId: string;
  template: string;
  name?: string;
  description?: string;
  instructions: string;
};

type ConnectedToolInfo = {
  name: string;
  description: string;
  instructions?: string;
};

@Injectable()
export class AiSuggestionsService {
  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly graphDao: GraphDao,
    private readonly graphRegistry: GraphRegistry,
    private readonly templateRegistry: TemplateRegistry,
    private readonly authContext: AuthContextService,
    private readonly openaiService: OpenaiService,
  ) {}

  async analyzeThread(
    threadId: string,
    payload: ThreadAnalysisRequestDto,
  ): Promise<ThreadAnalysisResponse> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadsDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const graph = await this.graphDao.getOne({
      id: thread.graphId,
      createdBy: userId,
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const compiledGraph = this.graphRegistry.get(thread.graphId);

    if (!compiledGraph) {
      throw new BadRequestException(
        'GRAPH_NOT_RUNNING',
        'Graph must be running to analyze threads',
      );
    }

    const messages = await this.messagesDao.getAll({
      threadId: thread.id,
      order: { createdAt: 'ASC' },
    });

    const sanitizedMessages = this.sanitizeMessages(
      messages.map((m) => ({ message: m.message, from: m.nodeId })),
      compiledGraph,
    );
    const agents = this.buildAgentContexts(compiledGraph);

    const isContinuation = !!payload.threadId;

    const systemPrompt = isContinuation
      ? undefined
      : [
          'You are an expert AI / agent-ops reviewer.',
          'Analyze the full thread messages and the current agent configuration.',
          'Identify root causes of issues, tool execution problems, and gaps or ambiguities in instructions or tools.',
          'Recommend concrete, generalizable improvements to agent instructions, tool usage and implementation, toolset design, and inputs.',
          'Do not overfit suggestions to this specific case; the agent must stay adaptable to any task, domain, or language.',
          'Keep the response concise, structured, and immediately actionable.',
          'Structure the answer with sections:',
          '- Key issues: bullet list of detected problems or risks.',
          '- Tooling problems: bullet list of tool-related issues, misconfigurations, or misuse.',
          '- Improvements: bullet list of changes to instructions, tools, and example inputs/prompts that reduce future issues.',
        ].join('\n');

    const message = isContinuation
      ? (payload.userInput || '').trim()
      : this.buildThreadPrompt({
          thread,
          graph,
          messages: sanitizedMessages,
          agents,
          userInput: payload.userInput,
        });

    const response = await this.openaiService.response(
      {
        systemMessage: systemPrompt,
        message,
      },
      {
        model: 'openai/gpt-5.2',
        reasoning: { effort: 'high' },
        previous_response_id: payload.threadId,
      },
    );

    const analysis = response.content?.trim() || '';

    return {
      analysis,
      conversationId: response.conversationId,
    };
  }

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
    const knowledgeInstructions = this.getConnectedKnowledge(
      graphId,
      nodeId,
      compiledGraph?.edges || graph.schema.edges,
      compiledGraph,
    );
    const effectiveInstructions = this.composeInstructions(
      currentInstructions,
      knowledgeInstructions,
    );
    const tools = this.getConnectedTools(
      graphId,
      nodeId,
      compiledGraph?.edges || graph.schema.edges,
      compiledGraph,
    );
    const mcpInstructions = this.getConnectedMcpInstructions(
      graphId,
      nodeId,
      compiledGraph?.edges || graph.schema.edges,
      compiledGraph,
    );

    const threadId = payload.threadId;
    const isContinuation = !!threadId;

    const systemMessage = isContinuation
      ? undefined
      : [
          'You rewrite agent system instructions.',
          'Use the current instructions as a base and apply the user request.',
          'Do not delete, simplify, compress, paraphrase, "clean up", merge, reorder, or otherwise modify existing instructions by default.',
          'All current instructions must remain exactly as-is (wording + structure), unless the user explicitly asks to change/remove/simplify specific parts.',
          'Only add the minimal necessary additions to satisfy the user request, without altering unrelated content.',
          "You can analyze connected tool capabilities and their usage guidelines. But don't duplicate Connected tools, MCP servers, and Knowledge sections information in your response. You can only refer to it if needed.",
          'Keep the result concise, actionable, and focused on how the agent should behave.',
          'Return only the updated instructions text without extra commentary. No need to add information about Connected tools, MCP servers, and Knowledge sections',
        ].join('\n');
    const message = isContinuation
      ? (payload.userRequest || '').trim()
      : this.buildInstructionRequestPrompt(
          payload.userRequest,
          effectiveInstructions,
          tools,
          mcpInstructions,
        );

    const response = await this.openaiService.response(
      {
        systemMessage,
        message,
      },
      {
        model: 'openai/gpt-5.2',
        reasoning: { effort: 'high' },
        previous_response_id: threadId,
      },
    );

    const updated = response.content?.trim();

    return {
      instructions: updated?.length ? updated : effectiveInstructions,
      threadId: response.conversationId,
    };
  }

  async suggestKnowledgeContent(
    graphId: string,
    nodeId: string,
    payload: SuggestKnowledgeContentDto,
  ): Promise<SuggestKnowledgeContentResponse> {
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
    if (!template || template.kind !== NodeKind.Knowledge) {
      throw new BadRequestException(
        'INVALID_NODE_TYPE',
        'Knowledge suggestions are only available for knowledge nodes',
      );
    }

    const compiledGraph = this.graphRegistry.get(graphId);
    if (!compiledGraph) {
      throw new BadRequestException(
        'GRAPH_NOT_RUNNING',
        'Graph must be running to suggest knowledge content',
      );
    }

    const knowledgeContent = this.getKnowledgeContent(
      compiledGraph,
      nodeId,
      node.config,
    );
    const baseContent = knowledgeContent ?? '';
    const threadId = payload.threadId;
    const userRequest = (payload.userRequest || '').trim();
    const isContinuation = !!threadId;

    const systemMessage = isContinuation
      ? undefined
      : this.buildKnowledgeSystemPrompt();
    const response = await this.openaiService.response(
      {
        systemMessage,
        message: this.buildKnowledgeRequestPrompt(userRequest, baseContent),
      },
      {
        model: 'openai/gpt-5.2',
        reasoning: { effort: 'high' },
        previous_response_id: threadId,
      },
    );

    const content = response.content?.trim();

    return {
      content: content?.length ? content : baseContent || userRequest,
      threadId: response.conversationId,
    };
  }

  private buildThreadPrompt(data: {
    thread: ThreadEntity;
    graph: GraphEntity;
    messages: SanitizedMessage[];
    agents: AgentContext[];
    userInput?: string;
  }): string {
    const threadStatusLine = `Thread status: ${data.thread.status}`;
    const userInputSection = data.userInput
      ? ['User request:', data.userInput.trim().length]
      : null;

    const agentSection = data.agents.length
      ? data.agents
          .map((agent) => {
            const displayName = agent.name || agent.nodeId;
            const subblockId = `agent_${agent.nodeId}`;
            return [
              `<<<SUBBLOCK id=${subblockId} name="${displayName}">>>`,
              `Agent ${displayName} (${agent.template})`,
              `Instructions:\n${agent.instructions}`,
              `<<<END SUBBLOCK id=${subblockId}>>>`,
            ]
              .filter(Boolean)
              .join('\n');
          })
          .join('\n\n')
      : 'No agent configuration available.';

    const messagesSection = data.messages.length
      ? data.messages
          .map((msg, idx) => this.formatMessage(idx + 1, msg))
          .join('\n')
      : 'No messages available for this thread.';

    const wrapBlock = (id: string, purpose: string, content: string): string =>
      [
        `<<<BLOCK id=${id} purpose="${purpose}">>>`,
        content,
        `<<<END BLOCK id=${id}>>>`,
      ].join('\n');

    const statusBlock = wrapBlock(
      'information',
      'General information',
      [threadStatusLine, ...(userInputSection || [])].join('\n\n'),
    );
    const agentsBlock = wrapBlock(
      'agents',
      'Providing information about agents',
      ['Agents configuration:', agentSection].join('\n\n'),
    );
    const messagesBlock = wrapBlock(
      'messages',
      'Thread messages',
      ['Thread messages (oldest first):', messagesSection].join('\n\n'),
    );

    return [
      statusBlock,
      agentsBlock,
      messagesBlock,
      'Provide the requested analysis using the structure from the system instructions.',
    ].join('\n\n');
  }

  private formatMessage(index: number, msg: SanitizedMessage): string {
    if (msg.role === 'tool') {
      return [
        `${index}. tool message from ${msg.from}`,
        `content: ${msg.content}`,
        msg.title ? `title: ${msg.title}` : null,
      ]
        .filter(Boolean)
        .join(' ');
    }

    if (msg.role === 'tool-shell') {
      const stdout = msg.stdout ? `stdout: ${msg.stdout}` : null;
      const stderr = msg.stderr ? `stderr: ${msg.stderr}` : null;
      return [
        `${index}. tool-shell message from ${msg.from}`,
        `exitCode: ${msg.exitCode}`,
        stdout,
        stderr,
      ]
        .filter(Boolean)
        .join(' ');
    }

    const toolCalls = msg.toolCalls?.length
      ? `toolCalls: ${msg.toolCalls
          .map((tc) =>
            tc.args
              ? `${tc.name} args: ${this.safeStringify(tc.args)}`
              : tc.name,
          )
          .join('; ')}`
      : null;

    return [
      `${index}. ${msg.role} message from ${msg.from}:`,
      msg.content,
      toolCalls,
    ]
      .filter(Boolean)
      .join(' ');
  }

  private sanitizeMessages(
    messages: { message: MessageDto; from: string }[],
    compiledGraph: CompiledGraph,
  ): SanitizedMessage[] {
    return messages.map(({ message, from }) => {
      const fromLabel = this.getNodeDisplayName(compiledGraph, from);

      if (message.role === 'human') {
        return {
          role: 'human',
          content: message.content,
          from: fromLabel,
        };
      }

      if (message.role === 'ai') {
        return {
          role: 'ai',
          content: message.content,
          from: fromLabel,
          toolCalls: message.toolCalls?.map((tc) => ({
            name: tc.name,
            args: isPlainObject(tc.args as unknown)
              ? (tc.args as UnknownRecord)
              : undefined,
            type: typeof tc.type === 'string' ? tc.type : undefined,
          })),
        };
      }

      if (message.role === 'reasoning') {
        return {
          role: 'reasoning',
          content: message.content,
          from: fromLabel,
        };
      }

      if (message.role === 'tool') {
        return {
          role: 'tool',
          name: message.name,
          content: this.safeStringify(message.content),
          from: fromLabel,
          title: message.title,
        };
      }

      if (message.role === 'tool-shell') {
        const content = message.content as unknown;
        const rec: UnknownRecord = isPlainObject(content)
          ? (content as UnknownRecord)
          : {};
        const exitCode =
          typeof rec.exitCode === 'number'
            ? rec.exitCode
            : Number(rec.exitCode) || 0;
        const stdout = typeof rec.stdout === 'string' ? rec.stdout : undefined;
        const stderr = typeof rec.stderr === 'string' ? rec.stderr : undefined;

        return {
          role: 'tool-shell',
          name: 'shell',
          exitCode,
          stdout,
          stderr,
          from: fromLabel,
        };
      }

      return {
        role: 'system',
        content:
          typeof message.content === 'string'
            ? message.content
            : this.safeStringify(message.content),
        from: fromLabel,
      };
    });
  }

  private getNodeDisplayName(
    compiledGraph: CompiledGraph,
    nodeId: string,
  ): string {
    const node = compiledGraph.nodes.get(nodeId) as unknown;
    if (!node) {
      return nodeId;
    }

    const nodeType = (node as { type?: unknown }).type;

    if (nodeType === NodeKind.SimpleAgent) {
      const cfg = (node as { config?: unknown }).config;
      const cfgRecord: UnknownRecord | undefined = isPlainObject(cfg)
        ? (cfg as UnknownRecord)
        : undefined;
      const name =
        cfgRecord &&
        isString(cfgRecord.name) &&
        cfgRecord.name.trim().length > 0
          ? cfgRecord.name
          : undefined;
      return name || nodeId;
    }

    if (nodeType === NodeKind.Tool) {
      const instance = (node as { instance?: unknown }).instance;
      if (Array.isArray(instance)) {
        const first = instance[0] as unknown;
        const firstRecord: UnknownRecord | undefined = isPlainObject(first)
          ? (first as UnknownRecord)
          : undefined;
        const name =
          firstRecord &&
          isString(firstRecord.name) &&
          firstRecord.name.trim().length > 0
            ? firstRecord.name
            : undefined;
        return name || nodeId;
      }

      const instanceRecord: UnknownRecord | undefined = isPlainObject(instance)
        ? (instance as UnknownRecord)
        : undefined;
      const name =
        instanceRecord &&
        isString(instanceRecord.name) &&
        instanceRecord.name.trim().length > 0
          ? instanceRecord.name
          : undefined;
      return name || nodeId;
    }

    return nodeId;
  }

  private buildAgentContexts(compiledGraph: CompiledGraph): AgentContext[] {
    const agentNodes = Array.from(compiledGraph.nodes.values()).filter(
      (node) => node.type === NodeKind.SimpleAgent,
    );

    return agentNodes.map((node) => {
      const config = node.config as {
        name?: string;
        description?: string;
        instructions?: string;
      };
      const instanceInstructions = (
        node.instance as { currentConfig?: { instructions?: string } }
      )?.currentConfig?.instructions;

      const instructions = (
        instanceInstructions ??
        config.instructions ??
        ''
      ).trim();

      return {
        nodeId: node.id,
        template: node.template,
        name: config.name,
        description: config.description,
        instructions,
      };
    });
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
    edges: GraphEdgeSchemaType[] | undefined,
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

  private getConnectedKnowledge(
    graphId: string,
    nodeId: string,
    edges: GraphEdgeSchemaType[] | undefined,
    compiledGraph?: CompiledGraph,
  ): string | undefined {
    if (!compiledGraph) {
      return undefined;
    }

    const outgoingNodeIds = new Set(
      (edges || [])
        .filter((edge) => edge.from === nodeId)
        .map((edge) => edge.to),
    );

    if (!outgoingNodeIds.size) {
      return undefined;
    }

    const knowledgeNodeIds = this.graphRegistry.filterNodesByType(
      graphId,
      outgoingNodeIds,
      NodeKind.Knowledge,
    );

    const blocks = knowledgeNodeIds
      .map((knowledgeNodeId) => {
        const knowledgeNode = this.graphRegistry.getNode<{
          content?: string;
        }>(graphId, knowledgeNodeId);
        if (!knowledgeNode || knowledgeNode.type !== NodeKind.Knowledge) {
          return undefined;
        }

        const content =
          (knowledgeNode.instance as IBaseKnowledgeOutput | undefined)
            ?.content ??
          (knowledgeNode.config as SimpleKnowledgeConfig)?.content;

        if (typeof content !== 'string') {
          return undefined;
        }

        const trimmed = content.trim();
        if (!trimmed) {
          return undefined;
        }

        return trimmed;
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## Knowledge', ...blocks].join('\n\n');
  }

  private getConnectedMcpInstructions(
    graphId: string,
    nodeId: string,
    edges: GraphEdgeSchemaType[] | undefined,
    compiledGraph?: CompiledGraph,
  ): string | undefined {
    if (!compiledGraph) {
      return undefined;
    }

    const outgoingNodeIds = new Set(
      (edges || [])
        .filter((edge) => edge.from === nodeId)
        .map((edge) => edge.to),
    );

    if (!outgoingNodeIds.size) {
      return undefined;
    }

    const mcpNodeIds = this.graphRegistry.filterNodesByType(
      graphId,
      outgoingNodeIds,
      NodeKind.Mcp,
    );

    const blocks = mcpNodeIds
      .map((mcpNodeId) => {
        const mcpNode = this.graphRegistry.getNode<BaseMcp<unknown>>(
          graphId,
          mcpNodeId,
        );
        if (!mcpNode || mcpNode.type !== NodeKind.Mcp) {
          return undefined;
        }

        const mcpService = mcpNode.instance;
        if (!mcpService) {
          return undefined;
        }

        // Get detailed instructions from MCP service
        const instructions = mcpService.getDetailedInstructions?.(
          mcpService.config as never,
        );

        if (typeof instructions !== 'string') {
          return undefined;
        }

        const trimmed = instructions.trim();
        if (!trimmed) {
          return undefined;
        }

        return trimmed;
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## MCP Instructions', ...blocks].join('\n\n');
  }

  private buildInstructionRequestPrompt(
    userRequest: string,
    currentInstructions: string,
    tools: ConnectedToolInfo[],
    mcpInstructions?: string,
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

    const mcpSection = mcpInstructions
      ? `Connected MCP servers (NEVER INCLUDE IT IN YOUR ANSWER):\n${mcpInstructions}`
      : undefined;

    return [
      `User request:\n${userRequest}`,
      `Current instructions:\n${currentInstructions}`,
      `Connected tools (NEVER INCLUDE IT IN YOUR ANSWER):\n${toolsSection}`,
      mcpSection,
      'Provide the full updated instructions. Do not include a preamble.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private composeInstructions(
    baseInstructions: string,
    knowledgeInstructions?: string,
  ): string {
    return [baseInstructions, knowledgeInstructions]
      .filter(Boolean)
      .join('\n\n');
  }

  private buildKnowledgeSystemPrompt(): string {
    return [
      'You generate concise knowledge blocks to be injected into agent knowledge nodes.',
      'Use the user request to produce factual, actionable content.',
      'Keep it succinct and structured with clear bullets or short paragraphs.',
      'Avoid instructions to the model; only provide the knowledge content.',
    ].join('\n');
  }

  private buildKnowledgeRequestPrompt(
    userRequest: string,
    currentContent: string,
  ): string {
    return [
      `User request:\n${userRequest}`,
      currentContent
        ? `Current knowledge content:\n${currentContent}`
        : 'Current knowledge content: (empty)',
      'Provide the full updated knowledge content. Do not include a preamble.',
    ].join('\n\n');
  }

  private getKnowledgeContent(
    compiledGraph: CompiledGraph,
    nodeId: string,
    fallbackConfig: unknown,
  ): string | undefined {
    const node = compiledGraph.nodes.get(nodeId);
    const contentFromInstance = (
      node?.instance as { content?: unknown } | undefined
    )?.content;
    const contentFromConfig = (fallbackConfig as { content?: unknown })
      ?.content;
    const content =
      typeof contentFromInstance === 'string'
        ? contentFromInstance
        : typeof contentFromConfig === 'string'
          ? contentFromConfig
          : undefined;

    return content?.trim() || undefined;
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}
