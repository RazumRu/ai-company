import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

import { GraphDao } from '../../graphs/dao/graph.dao';
import { MessageDto } from '../../graphs/dto/graphs.dto';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import { CompiledGraph, NodeKind } from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { OpenaiService } from '../../openai/openai.service';
import { MessagesDao } from '../dao/messages.dao';
import { ThreadsDao } from '../dao/threads.dao';
import {
  ThreadAnalysisRequestDto,
  ThreadAnalysisResponse,
} from '../dto/ai-suggestions.dto';
import { ThreadEntity } from '../entity/thread.entity';

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

@Injectable()
export class AiSuggestionsService {
  constructor(
    private readonly threadsDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly graphDao: GraphDao,
    private readonly graphRegistry: GraphRegistry,
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

    const prompt = this.buildPrompt({
      thread,
      graph,
      messages: sanitizedMessages,
      agents,
      userInput: payload.userInput,
    });

    const systemPrompt = [
      'You are an expert AI/agentops reviewer.',
      'Analyze the provided thread messages and agent configuration.',
      'Identify root causes of issues, tool execution problems, and gaps in instructions or tools.',
      'Recommend concrete improvements to agent instructions, tool usage, toolset, or inputs.',
      'Keep the response concise and actionable.',
      'Structure the answer with sections:',
      '- KeyIssues: bullet list of detected problems or risks.',
      '- ToolingProblems: bullet list of tool-related issues or misuse.',
      '- InstructionAndToolsetImprovements: bullet list of changes to instructions or toolset.',
      '- InputImprovements: bullet list of better inputs/prompts/examples to reduce issues.',
    ].join('\n');

    const response = await this.openaiService.response(
      {
        systemMessage: systemPrompt,
        message: prompt,
      },
      {
        model: 'gpt-5.1',
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

  private buildPrompt(data: {
    thread: ThreadEntity;
    graph: GraphEntity;
    messages: SanitizedMessage[];
    agents: AgentContext[];
    userInput?: string;
  }): string {
    const threadStatusLine = `Thread status: ${data.thread.status}`;
    const userInputSection = [
      'User request:',
      data.userInput && data.userInput.trim().length
        ? data.userInput
        : 'No user request provided.',
    ];

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
      [threadStatusLine, ...userInputSection].join('\n\n'),
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
            args: tc.args,
            type: tc.type,
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
        return {
          role: 'tool-shell',
          name: 'shell',
          exitCode: message.content.exitCode,
          stdout: message.content.stdout,
          stderr: message.content.stderr,
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

  private getNodeDisplayName(compiledGraph: CompiledGraph, nodeId: string) {
    const node = compiledGraph.nodes.get(nodeId);
    if (!node) {
      return nodeId;
    }

    if (node.type === NodeKind.SimpleAgent) {
      const name = (node.config as { name?: string })?.name;
      return name || nodeId;
    }

    if (node.type === NodeKind.Tool) {
      const instance = node.instance;
      const toolName =
        (Array.isArray(instance)
          ? instance[0]?.name
          : (instance as { name?: string })?.name) || nodeId;
      return toolName;
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
