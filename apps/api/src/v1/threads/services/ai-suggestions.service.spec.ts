import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../graphs/dao/graph.dao';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import {
  CompiledGraph,
  GraphStatus,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphStateManager } from '../../graphs/services/graph-state.manager';
import { OpenaiService } from '../../openai/openai.service';
import { MessagesDao } from '../dao/messages.dao';
import { ThreadsDao } from '../dao/threads.dao';
import { ThreadStatus } from '../threads.types';
import { AiSuggestionsService } from './ai-suggestions.service';

describe('AiSuggestionsService', () => {
  let threadsDao: Pick<ThreadsDao, 'getOne'>;
  let messagesDao: Pick<MessagesDao, 'getAll'>;
  let graphDao: Pick<GraphDao, 'getOne'>;
  let graphRegistry: Pick<GraphRegistry, 'get'>;
  let authContext: Pick<AuthContextService, 'checkSub'>;
  let openaiService: Pick<OpenaiService, 'response'>;
  let service: AiSuggestionsService;

  beforeEach(() => {
    threadsDao = { getOne: vi.fn() };
    messagesDao = { getAll: vi.fn() };
    graphDao = { getOne: vi.fn() };
    graphRegistry = { get: vi.fn() };
    authContext = {
      checkSub: vi.fn().mockReturnValue('user-1'),
    };
    openaiService = {
      response: vi.fn(),
    };

    service = new AiSuggestionsService(
      threadsDao as ThreadsDao,
      messagesDao as MessagesDao,
      graphDao as GraphDao,
      graphRegistry as GraphRegistry,
      authContext as AuthContextService,
      openaiService as OpenaiService,
    );
  });

  const buildGraph = (): GraphEntity =>
    ({
      id: 'graph-1',
      name: 'Test graph',
      description: 'Graph for testing',
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: {
        nodes: [
          { id: 'agent-1', template: 'simple-agent', config: {} },
          { id: 'tool-1', template: 'search-tool', config: {} },
        ],
        edges: [{ from: 'agent-1', to: 'tool-1' }],
      },
      status: GraphStatus.Running,
      metadata: {},
      createdBy: 'user-1',
      temporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }) as unknown as GraphEntity;

  const buildCompiledGraph = (): CompiledGraph => {
    const compiled: CompiledGraph = {
      nodes: new Map(),
      edges: [{ from: 'agent-1', to: 'tool-1' }],
      state: {} as GraphStateManager,
      destroy: vi.fn(),
      status: GraphStatus.Running,
    };

    compiled.nodes.set('agent-1', {
      id: 'agent-1',
      type: NodeKind.SimpleAgent,
      template: 'simple-agent',
      instance: {} as never,
      config: {
        name: 'Primary agent',
        description: 'Handles user requests',
        instructions: 'Be concise.',
      },
    });

    compiled.nodes.set('tool-1', {
      id: 'tool-1',
      type: NodeKind.Tool,
      template: 'search-tool',
      instance: {
        name: 'Search',
        description: 'Search the web',
        __instructions: 'Use to gather facts.',
      },
      config: {},
    });

    return compiled;
  };

  it('throws when thread is not found', async () => {
    (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await expect(
      service.analyzeThread('missing', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when compiled graph is missing', async () => {
    (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'thread-1',
      graphId: 'graph-1',
      createdBy: 'user-1',
      externalThreadId: 'ext-thread',
      status: ThreadStatus.Running,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      source: null,
      name: null,
    });
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildGraph(),
    );
    (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await expect(
      service.analyzeThread('thread-1', {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns prompt content when analysis is generated and uses provided thread id', async () => {
    (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'thread-1',
      graphId: 'graph-1',
      createdBy: 'user-1',
      externalThreadId: 'ext-thread',
      status: ThreadStatus.Running,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
      source: null,
      name: null,
    });
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
      buildGraph(),
    );
    (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
      buildCompiledGraph(),
    );
    (messagesDao.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'msg-0',
        threadId: 'thread-1',
        externalThreadId: 'ext-thread',
        nodeId: 'agent-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        message: {
          role: 'system',
          content: 'System intro',
        },
      },
      {
        id: 'msg-1',
        threadId: 'thread-1',
        externalThreadId: 'ext-thread',
        nodeId: 'agent-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        message: {
          role: 'human',
          content: 'How is the weather?',
        },
      },
      {
        id: 'msg-2',
        threadId: 'thread-1',
        externalThreadId: 'ext-thread',
        nodeId: 'agent-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        message: {
          role: 'ai',
          content: 'I will check.',
          toolCalls: [
            {
              name: 'search',
              args: { query: 'weather today' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
        },
      },
      {
        id: 'msg-3',
        threadId: 'thread-1',
        externalThreadId: 'ext-thread',
        nodeId: 'tool-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        message: {
          role: 'tool',
          name: 'search',
          content: { result: 'Sunny' },
          toolCallId: 'call-1',
          title: 'Weather lookup',
        },
      },
      {
        id: 'msg-4',
        threadId: 'thread-1',
        externalThreadId: 'ext-thread',
        nodeId: 'tool-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        message: {
          role: 'tool-shell',
          name: 'shell',
          content: { stdout: 'ok', stderr: '', exitCode: 0 },
          toolCallId: 'call-2',
        },
      },
    ]);
    (openaiService.response as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'Issue summary and suggestions',
      conversationId: 'conv-1',
    });

    const result = await service.analyzeThread('thread-1', {
      userInput: 'Focus on tooling issues',
      threadId: 'prev-thread',
    });

    expect(result).toEqual({
      analysis: 'Issue summary and suggestions',
      conversationId: 'conv-1',
    });

    const calls = (openaiService.response as ReturnType<typeof vi.fn>).mock
      .calls;
    expect(calls.length).toBe(1);
    const [payload, params] = calls[0] as [
      { systemMessage?: string; message: string },
      { previous_response_id?: string },
    ];
    expect(payload.message).toContain('Agent configuration:');
    expect(payload.message).toContain('Thread messages (oldest first):');
    expect(payload.message).toContain('System intro');
    expect(payload.message).toContain('How is the weather?');
    expect(payload.message).toContain('toolCalls');
    expect(payload.message).toContain('User input:');
    expect(payload.message).toContain('Focus on tooling issues');
    expect(params.previous_response_id).toBe('prev-thread');
  });
});
