import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import {
  CompiledGraph,
  GraphEdgeSchemaType,
  GraphStatus,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphStateManager } from '../../graphs/services/graph-state.manager';
import { OpenaiService } from '../../openai/openai.service';
import { MessagesDao } from '../../threads/dao/messages.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { ThreadStatus } from '../../threads/threads.types';
import { SuggestAgentInstructionsDto } from '../dto/agent-instructions.dto';
import { SuggestKnowledgeContentDto } from '../dto/knowledge-suggestions.dto';
import { AiSuggestionsService } from './ai-suggestions.service';

describe('AiSuggestionsService', () => {
  let threadsDao: Pick<ThreadsDao, 'getOne'>;
  let messagesDao: Pick<MessagesDao, 'getAll'>;
  let graphDao: Pick<GraphDao, 'getOne'>;
  let graphRegistry: Pick<
    GraphRegistry,
    'get' | 'filterNodesByType' | 'getNode'
  >;
  let templateRegistry: Pick<TemplateRegistry, 'getTemplate'>;
  let authContext: Pick<AuthContextService, 'checkSub'>;
  let openaiService: { response: OpenaiService['response'] };
  let responseMock: ReturnType<typeof vi.fn> & OpenaiService['response'];
  let service: AiSuggestionsService;

  beforeEach(() => {
    threadsDao = { getOne: vi.fn() };
    messagesDao = { getAll: vi.fn() };
    graphDao = { getOne: vi.fn() };
    graphRegistry = {
      get: vi.fn(),
      filterNodesByType: vi.fn(),
      getNode: vi.fn(),
    };
    templateRegistry = { getTemplate: vi.fn() };
    authContext = {
      checkSub: vi.fn().mockReturnValue('user-1'),
    };
    responseMock = vi.fn(async () => ({
      content: 'Updated instructions',
      conversationId: 'thread-1',
    })) as ReturnType<typeof vi.fn> & OpenaiService['response'];
    openaiService = {
      response: responseMock,
    };

    service = new AiSuggestionsService(
      threadsDao as ThreadsDao,
      messagesDao as MessagesDao,
      graphDao as GraphDao,
      graphRegistry as GraphRegistry,
      templateRegistry as TemplateRegistry,
      authContext as AuthContextService,
      openaiService as OpenaiService,
    );
  });

  const buildGraph = (): GraphEntity =>
    ({
      id: 'graph-1',
      name: 'Test Graph',
      description: undefined,
      error: undefined,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: { instructions: 'Base instructions' },
          },
          { id: 'tool-1', template: 'sample-tool', config: {} },
        ],
        edges: [{ from: 'agent-1', to: 'tool-1' }],
      },
      status: GraphStatus.Running,
      metadata: undefined,
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

  const configureSuggestionHappyPath = () => {
    const graph = buildGraph();
    (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);

    (templateRegistry.getTemplate as ReturnType<typeof vi.fn>).mockReturnValue({
      kind: NodeKind.SimpleAgent,
    });

    (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
      edges: graph.schema.edges as GraphEdgeSchemaType[],
    });

    (
      graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
    ).mockImplementation((_graphId, _nodeIds, type) =>
      type === NodeKind.Tool ? ['tool-1'] : [],
    );

    (graphRegistry.getNode as ReturnType<typeof vi.fn>).mockReturnValue({
      type: NodeKind.Tool,
      instance: [
        {
          name: 'Sample Tool',
          description: 'Does work',
          __instructions: 'Use it',
        },
      ],
    });
  };

  describe('suggest', () => {
    it('returns updated instructions from LLM response', async () => {
      configureSuggestionHappyPath();

      const result = await service.suggest('graph-1', 'agent-1', {
        userRequest: 'Make it concise',
        threadId: 'thread-1',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toBe('Updated instructions');
      expect(result.threadId).toBe('thread-1');
      expect(responseMock).toHaveBeenCalledTimes(1);
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toBe('Make it concise');
      expect(params.previous_response_id).toBe('thread-1');
    });

    it('falls back to current instructions when LLM returns empty', async () => {
      configureSuggestionHappyPath();
      responseMock.mockResolvedValueOnce({
        content: '   ',
        conversationId: 'thread-1',
      });

      const result = await service.suggest('graph-1', 'agent-1', {
        userRequest: 'Keep as is',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toBe('Base instructions');
      expect(result.threadId).toBe('thread-1');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain(
        'You rewrite agent system instructions.',
      );
      expect(payload.message).toContain('Base instructions');
      expect(params.previous_response_id).toBeUndefined();
    });

    it('generates threadId when not provided', async () => {
      configureSuggestionHappyPath();

      const result = await service.suggest('graph-1', 'agent-1', {
        userRequest: 'Generate id',
      } as SuggestAgentInstructionsDto);

      expect(result.threadId).toBe('thread-1');
    });

    it('throws when graph is not found', async () => {
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.suggest('missing', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when node is not found', async () => {
      const graph = buildGraph();
      graph.schema.nodes = [];
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);

      await expect(
        service.suggest('graph-1', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when node is not an agent', async () => {
      const graph = buildGraph();
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (
        templateRegistry.getTemplate as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        kind: NodeKind.Tool,
      });

      await expect(
        service.suggest('graph-1', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when graph is not running (no compiled graph)', async () => {
      const graph = buildGraph();
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (
        templateRegistry.getTemplate as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        kind: NodeKind.SimpleAgent,
      });
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );

      await expect(
        service.suggest('graph-1', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('includes knowledge content in the prompt and fallback instructions', async () => {
      const graph = buildGraph();
      graph.schema.nodes.push({
        id: 'knowledge-1',
        template: 'simple-knowledge',
        config: { content: 'Important facts' },
      });
      graph.schema.edges ??= [];
      graph.schema.edges.push({ from: 'agent-1', to: 'knowledge-1' });

      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (
        templateRegistry.getTemplate as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        kind: NodeKind.SimpleAgent,
      });
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
        edges: graph.schema.edges,
      });
      (
        graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
      ).mockImplementation((_graphId, _nodeIds, type) => {
        if (type === NodeKind.Knowledge) return ['knowledge-1'];
        return [];
      });
      (graphRegistry.getNode as ReturnType<typeof vi.fn>).mockReturnValue({
        type: NodeKind.Knowledge,
        instance: { content: 'Important facts' },
        config: { content: 'Important facts' },
      });

      responseMock.mockResolvedValueOnce({
        content: ' ',
        conversationId: 'thread-2',
      });

      const result = await service.suggest('graph-1', 'agent-1', {
        userRequest: 'summarize',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toContain('Important facts');
      const promptArg = (responseMock.mock.calls[0] as unknown[])[0] as {
        message: string;
      };
      expect(promptArg.message).toContain('Important facts');
    });
  });

  describe('analyzeThread', () => {
    const buildThread = (): ThreadEntity =>
      ({
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
      }) as unknown as ThreadEntity;

    it('throws when thread is not found', async () => {
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.analyzeThread('missing', {} as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when compiled graph is missing', async () => {
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildThread(),
      );
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildGraph(),
      );
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );

      await expect(
        service.analyzeThread('thread-1', {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns prompt content when analysis is generated and uses provided thread id', async () => {
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildThread(),
      );
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
      responseMock.mockResolvedValue({
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

      const calls = responseMock.mock.calls;
      expect(calls.length).toBe(1);
      const [payload, params] = calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toBe('Focus on tooling issues');
      expect(params.previous_response_id).toBe('prev-thread');
    });
  });

  describe('suggestKnowledgeContent', () => {
    const configureKnowledgeHappyPath = () => {
      const graph = buildGraph();
      graph.schema.nodes = [
        {
          id: 'knowledge-1',
          template: 'simple-knowledge',
          config: { content: 'Existing knowledge' },
        },
      ];
      graph.schema.edges = [];

      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (
        templateRegistry.getTemplate as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        kind: NodeKind.Knowledge,
      });
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue({
        nodes: new Map([
          [
            'knowledge-1',
            {
              id: 'knowledge-1',
              type: NodeKind.Knowledge,
              template: 'simple-knowledge',
              instance: { content: 'Existing knowledge' },
              config: { content: 'Existing knowledge' },
            },
          ],
        ]),
      } as unknown as CompiledGraph);
    };

    it('returns generated content and respects thread continuation', async () => {
      configureKnowledgeHappyPath();
      responseMock.mockResolvedValueOnce({
        content: 'Generated knowledge block',
        conversationId: 'knowledge-thread-1',
      });

      const result = await service.suggestKnowledgeContent(
        'graph-1',
        'knowledge-1',
        {
          userRequest: 'Provide facts about the product',
          threadId: 'prev-thread-knowledge',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Generated knowledge block');
      expect(result.threadId).toBe('knowledge-thread-1');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toContain('Existing knowledge');
      expect(payload.message).toContain('Provide facts about the product');
      expect(params.previous_response_id).toBe('prev-thread-knowledge');
    });

    it('falls back to user request when model returns empty', async () => {
      configureKnowledgeHappyPath();
      responseMock.mockResolvedValueOnce({
        content: '   ',
        conversationId: 'knowledge-thread-2',
      });

      const result = await service.suggestKnowledgeContent(
        'graph-1',
        'knowledge-1',
        {
          userRequest: 'Summarize safety policies',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Existing knowledge');
      expect(result.threadId).toBe('knowledge-thread-2');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain(
        'You generate concise knowledge blocks',
      );
      expect(payload.message).toContain('Existing knowledge');
      expect(payload.message).toContain('Summarize safety policies');
      expect(params.previous_response_id).toBeUndefined();
    });
  });
});
