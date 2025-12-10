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
      title?: string;
    }
  | {
      role: 'tool-shell';
      name: 'shell';
      exitCode: number;
      stdout?: string;
      stderr?: string;
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
      messages.map((m) => m.message),
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

    const analysis = response.content?.trim();

    return {
      analysis: analysis?.length ? analysis : prompt,
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
    const agentSection = data.agents.length
      ? data.agents
          .map((agent) => {
            return [
              `## Agent ${agent.nodeId} (${agent.template})${agent.name ? ` - ${agent.name}` : ''}`,
              `## Instructions:\n${agent.instructions}`,
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

    const userInputSection = data.userInput
      ? ['# User input:', data.userInput]
      : [];

    return [
      threadStatusLine,
      '# Agent configuration:',
      agentSection,
      '# Thread messages (oldest first):',
      messagesSection,
      ...userInputSection,
      'Provide the requested analysis using the structure from the system instructions.',
    ].join('\n\n');
  }

  private formatMessage(index: number, msg: SanitizedMessage): string {
    if (msg.role === 'tool') {
      return [
        `${index}. tool:${msg.name}`,
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
        `${index}. tool-shell:${msg.name}`,
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

    return [`${index}. ${msg.role}:`, msg.content, toolCalls]
      .filter(Boolean)
      .join(' ');
  }

  private sanitizeMessages(messages: MessageDto[]): SanitizedMessage[] {
    return messages.map((message) => {
      if (message.role === 'human') {
        return {
          role: 'human',
          content: message.content,
        };
      }

      if (message.role === 'ai') {
        return {
          role: 'ai',
          content: message.content,
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
        };
      }

      if (message.role === 'tool') {
        return {
          role: 'tool',
          name: message.name,
          content: this.safeStringify(message.content),
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
        };
      }

      return {
        role: 'system',
        content:
          typeof message.content === 'string'
            ? message.content
            : this.safeStringify(message.content),
      };
    });
  }

  private buildAgentContexts(compiledGraph: CompiledGraph): AgentContext[] {
    const agentNodes = Array.from(compiledGraph.nodes.values()).filter(
      (node) => node.type === NodeKind.SimpleAgent,
    );

    return agentNodes.map((node) => {
      const config = node.config as { name?: string; description?: string };

      const instructions =
        (node.config as { instructions?: string }).instructions ?? '';

      return {
        nodeId: node.id,
        template: node.template,
        name: config.name,
        description: config.description,
        instructions: instructions.trim(),
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
