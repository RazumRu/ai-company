import {
  BadRequestException,
  InternalException,
  NotFoundException,
} from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import {
  CompiledGraph,
  GraphEdgeSchemaType,
  GraphNodeInstanceHandle,
  GraphStatus,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphStateManager } from '../../graphs/services/graph-state.manager';
import { GraphsService } from '../../graphs/services/graphs.service';
import { LitellmService } from '../../litellm/services/litellm.service';
import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { MessagesDao } from '../../threads/dao/messages.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { ThreadStatus } from '../../threads/threads.types';
import {
  KnowledgeContentSuggestionRequest,
  SuggestAgentInstructionsDto,
} from '../dto/ai-suggestions.dto';
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
  let graphsService: Pick<GraphsService, 'runForSuggestions'>;
  const mockCtx = {
    checkSub: vi.fn().mockReturnValue('user-1'),
  } as unknown as AuthContextStorage;

  let openaiService: {
    response: OpenaiService['response'];
    complete: OpenaiService['complete'];
    jsonRequest: OpenaiService['jsonRequest'];
  };
  let llmModelsService: Pick<LlmModelsService, 'getAiSuggestionsDefaultModel'>;
  let litellmService: Pick<LitellmService, 'supportsResponsesApi'>;
  let responseMock: ReturnType<typeof vi.fn> & OpenaiService['response'];
  let completeMock: ReturnType<typeof vi.fn> & OpenaiService['complete'];
  let jsonRequestMock: ReturnType<typeof vi.fn> & OpenaiService['jsonRequest'];
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
    responseMock = vi.fn(async () => ({
      content: 'Updated instructions',
      conversationId: 'thread-1',
    })) as ReturnType<typeof vi.fn> & OpenaiService['response'];
    completeMock = vi.fn(async () => ({
      content: 'Updated instructions',
      conversationId: 'thread-1',
    })) as ReturnType<typeof vi.fn> & OpenaiService['complete'];
    jsonRequestMock = vi.fn(async () => ({
      content: { updates: [] },
      conversationId: 'thread-1',
    })) as ReturnType<typeof vi.fn> & OpenaiService['jsonRequest'];
    openaiService = {
      response: responseMock,
      complete: completeMock,
      jsonRequest: jsonRequestMock,
    };
    llmModelsService = {
      getAiSuggestionsDefaultModel: vi.fn().mockReturnValue('openai/gpt-5.2'),
    };
    litellmService = {
      supportsResponsesApi: vi.fn().mockResolvedValue(true),
    };

    // Default: runForSuggestions calls through to the callback
    // with whatever graphRegistry.get() returns as the compiled graph.
    graphsService = {
      runForSuggestions: vi
        .fn()
        .mockImplementation(
          async (
            graphId: string,
            _userId: string,
            callback: (cg: unknown) => Promise<unknown>,
          ) => {
            const compiledGraph = vi.mocked(graphRegistry.get)(graphId);
            return callback(compiledGraph);
          },
        ),
    };

    service = new AiSuggestionsService(
      threadsDao as ThreadsDao,
      messagesDao as MessagesDao,
      graphDao as GraphDao,
      graphRegistry as GraphRegistry,
      templateRegistry as TemplateRegistry,
      openaiService as OpenaiService,
      llmModelsService as LlmModelsService,
      litellmService as LitellmService,
      graphsService as GraphsService,
    );
  });

  const makeHandle = <TInstance, TConfig = unknown>(
    instance: TInstance,
  ): GraphNodeInstanceHandle<TInstance, TConfig> => ({
    provide: async () => instance,
    configure: async () => {},
    destroy: async () => {},
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
      handle: makeHandle({} as never),
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
      handle: makeHandle({
        name: 'Search',
        description: 'Search the web',
        __instructions: 'Use to gather facts.',
      }),
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
      handle: makeHandle([
        {
          name: 'Sample Tool',
          description: 'Does work',
          __instructions: 'Use it',
        },
      ]),
    });
  };

  describe('suggest', () => {
    it('returns updated instructions from LLM response', async () => {
      configureSuggestionHappyPath();

      const result = await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Make it concise',
        threadId: 'thread-1',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toBe('Updated instructions');
      expect(result.threadId).toBe('thread-1');
      expect(responseMock).toHaveBeenCalledTimes(1);
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toBe('Make it concise');
      expect(payload.model).toBe('openai/gpt-5.2');
      expect(params.previous_response_id).toBe('thread-1');
    });

    it('uses requested model when provided', async () => {
      configureSuggestionHappyPath();

      await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Make it concise',
        model: 'openai/custom-model',
      } as SuggestAgentInstructionsDto);

      const [payload] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.model).toBe('openai/custom-model');
    });

    it('falls back to current instructions when LLM returns empty', async () => {
      configureSuggestionHappyPath();
      responseMock.mockResolvedValueOnce({
        content: '   ',
        conversationId: 'thread-1',
      });

      const result = await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Keep as is',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toBe('Base instructions');
      expect(result.threadId).toBe('thread-1');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain(
        'You rewrite agent system instructions.',
      );
      expect(payload.message).toContain('Base instructions');
      expect(payload.model).toBe('openai/gpt-5.2');
      expect(params.previous_response_id).toBeUndefined();
    });

    it('includes instruction best practices in system message', async () => {
      configureSuggestionHappyPath();

      await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Improve structure',
      } as SuggestAgentInstructionsDto);

      const [payload] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        unknown,
      ];
      expect(payload.systemMessage).toContain(
        '<instruction_quality_guidelines>',
      );
      expect(payload.systemMessage).toContain('XML tags');
      expect(payload.systemMessage).toContain(
        'Prefer positive instructions over negatives',
      );
    });

    it('generates threadId when not provided', async () => {
      configureSuggestionHappyPath();

      const result = await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Generate id',
      } as SuggestAgentInstructionsDto);

      expect(result.threadId).toBe('thread-1');
    });

    it('throws when graph is not found', async () => {
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.suggest(mockCtx, 'missing', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when node is not found', async () => {
      const graph = buildGraph();
      graph.schema.nodes = [];
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);

      await expect(
        service.suggest(mockCtx, 'graph-1', 'agent-1', {
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
        service.suggest(mockCtx, 'graph-1', 'agent-1', {
          userRequest: 'anything',
        } as SuggestAgentInstructionsDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('calls graphsService.runForSuggestions with correct graphId and userId', async () => {
      configureSuggestionHappyPath();

      await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Make it concise',
      } as SuggestAgentInstructionsDto);

      expect(graphsService.runForSuggestions).toHaveBeenCalledWith(
        'graph-1',
        'user-1',
        expect.any(Function),
      );
    });

    it('wraps unexpected LLM errors in InternalException', async () => {
      configureSuggestionHappyPath();
      responseMock.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(
        service.suggest(mockCtx, 'graph-1', 'agent-1', {
          userRequest: 'Improve structure',
        } as SuggestAgentInstructionsDto),
      ).rejects.toSatisfy((error: InternalException) => {
        expect(error).toBeInstanceOf(InternalException);
        expect(error.errorCode).toBe('LLM_REQUEST_FAILED');
        return true;
      });
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
        service.analyzeThread(mockCtx, 'missing', {} as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('calls graphsService.runForSuggestions with correct graphId and userId', async () => {
      const thread = buildThread();
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(thread);
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildGraph(),
      );
      (messagesDao.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );

      await service.analyzeThread(mockCtx, 'thread-1', {} as never);

      expect(graphsService.runForSuggestions).toHaveBeenCalledWith(
        'graph-1',
        'user-1',
        expect.any(Function),
      );
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
            role: 'tool',
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

      const result = await service.analyzeThread(mockCtx, 'thread-1', {
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
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toBe('Focus on tooling issues');
      expect(payload.model).toBe('openai/gpt-5.2');
      expect(params.previous_response_id).toBe('prev-thread');
    });

    it('uses requested model when provided', async () => {
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildThread(),
      );
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildGraph(),
      );
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );
      (messagesDao.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.analyzeThread(mockCtx, 'thread-1', {
        model: 'openai/custom-model',
      } as never);

      const [payload] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.model).toBe('openai/custom-model');
    });
  });

  describe('suggestGraphInstructions', () => {
    it('uses requested model when provided', async () => {
      const graph = buildGraph();
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );
      (
        graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
      ).mockReturnValue([]);
      jsonRequestMock.mockResolvedValueOnce({
        content: { updates: [{ nodeId: 'agent-1', instructions: 'Updated' }] },
        conversationId: 'graph-1',
      });

      await service.suggestGraphInstructions(mockCtx, 'graph-1', {
        userRequest: 'Update instructions',
        model: 'openai/custom-model',
      });

      const [payload] = jsonRequestMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
      ];
      expect(payload.model).toBe('openai/custom-model');
    });
  });

  describe('on-demand compilation via graphsService', () => {
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

    it('suggest() — calls runForSuggestions when graph is not running', async () => {
      // Graph is not in the registry (would have been GRAPH_NOT_RUNNING before)
      const graph = buildGraph();
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (
        templateRegistry.getTemplate as ReturnType<typeof vi.fn>
      ).mockReturnValue({
        kind: NodeKind.SimpleAgent,
      });
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );
      (
        graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
      ).mockReturnValue([]);
      (graphRegistry.getNode as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined,
      );

      await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Improve',
      } as SuggestAgentInstructionsDto);

      expect(graphsService.runForSuggestions).toHaveBeenCalledWith(
        'graph-1',
        'user-1',
        expect.any(Function),
      );
    });

    it('suggest() — when graph is already running, uses existing compiled graph', async () => {
      const compiledGraph = buildCompiledGraph();
      configureSuggestionHappyPath();
      // Override mock so graphRegistry.get returns the already-running graph
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        compiledGraph,
      );

      const result = await service.suggest(mockCtx, 'graph-1', 'agent-1', {
        userRequest: 'Make it concise',
      } as SuggestAgentInstructionsDto);

      expect(result.instructions).toBeDefined();
      expect(graphsService.runForSuggestions).toHaveBeenCalledTimes(1);
    });

    it('analyzeThread() — delegates to graphsService.runForSuggestions', async () => {
      const thread = buildThread();
      (threadsDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(thread);
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildGraph(),
      );
      (messagesDao.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );

      await service.analyzeThread(mockCtx, 'thread-1', {} as never);

      expect(graphsService.runForSuggestions).toHaveBeenCalledWith(
        'graph-1',
        'user-1',
        expect.any(Function),
      );
    });

    it('suggestGraphInstructions() — delegates to graphsService.runForSuggestions', async () => {
      const graph = buildGraph();
      (graphDao.getOne as ReturnType<typeof vi.fn>).mockResolvedValue(graph);
      (graphRegistry.get as ReturnType<typeof vi.fn>).mockReturnValue(
        buildCompiledGraph(),
      );
      (
        graphRegistry.filterNodesByType as ReturnType<typeof vi.fn>
      ).mockReturnValue([]);
      jsonRequestMock.mockResolvedValueOnce({
        content: { updates: [] },
        conversationId: 'graph-1',
      });

      await service.suggestGraphInstructions(mockCtx, 'graph-1', {
        userRequest: 'Improve all agents',
      });

      expect(graphsService.runForSuggestions).toHaveBeenCalledWith(
        'graph-1',
        'user-1',
        expect.any(Function),
      );
    });

    it('suggestKnowledgeContent() — works without graph (no runForSuggestions call)', async () => {
      // suggestKnowledgeContent has no graph dependency
      responseMock.mockResolvedValueOnce({
        content: { title: 'T', content: 'C' },
        conversationId: 'k-1',
      });

      await service.suggestKnowledgeContent(mockCtx, {
        userRequest: 'Create doc',
      } as import('../dto/ai-suggestions.dto').KnowledgeContentSuggestionRequest);

      expect(graphsService.runForSuggestions).not.toHaveBeenCalled();
    });
  });

  describe('suggestKnowledgeContent', () => {
    it('returns suggested knowledge content from LLM response', async () => {
      responseMock.mockResolvedValueOnce({
        content: {
          title: 'Knowledge title',
          content: 'Knowledge content',
          tags: ['ai', 'docs'],
        },
        conversationId: 'knowledge-1',
      });

      const result = await service.suggestKnowledgeContent(mockCtx, {
        userRequest: 'Create a knowledge doc',
        currentTitle: 'Old title',
        currentContent: 'Old content',
        currentTags: ['legacy'],
      } as KnowledgeContentSuggestionRequest);

      expect(result).toEqual({
        title: 'Knowledge title',
        content: 'Knowledge content',
        tags: ['ai', 'docs'],
        threadId: 'knowledge-1',
      });

      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain('knowledge base content');
      expect(payload.message).toContain('Old content');
      expect(payload.model).toBe('openai/gpt-5.2');
      expect(params.previous_response_id).toBeUndefined();
    });

    it('uses continuation thread without system message', async () => {
      responseMock.mockResolvedValueOnce({
        content: {
          title: 'Updated title',
          content: 'Updated content',
        },
        conversationId: 'knowledge-2',
      });

      const result = await service.suggestKnowledgeContent(mockCtx, {
        userRequest: 'Add a troubleshooting section',
        threadId: 'prev-knowledge',
      } as KnowledgeContentSuggestionRequest);

      expect(result.threadId).toBe('knowledge-2');

      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toBe('Add a troubleshooting section');
      expect(payload.model).toBe('openai/gpt-5.2');
      expect(params.previous_response_id).toBe('prev-knowledge');
    });

    it('uses requested model when provided', async () => {
      responseMock.mockResolvedValueOnce({
        content: {
          title: 'Updated title',
          content: 'Updated content',
        },
        conversationId: 'knowledge-4',
      });

      await service.suggestKnowledgeContent(mockCtx, {
        userRequest: 'Add a section',
        model: 'openai/custom-model',
      } as KnowledgeContentSuggestionRequest);

      const [payload] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string; model: string },
        { previous_response_id?: string },
      ];
      expect(payload.model).toBe('openai/custom-model');
    });

    it('throws when LLM response is invalid', async () => {
      responseMock.mockResolvedValueOnce({
        content: { title: '', content: '' },
        conversationId: 'knowledge-3',
      });

      await expect(
        service.suggestKnowledgeContent(mockCtx, {
          userRequest: 'Make improvements',
          currentContent: 'Existing content',
        } as KnowledgeContentSuggestionRequest),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
