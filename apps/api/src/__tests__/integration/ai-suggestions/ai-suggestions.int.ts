import { INestApplication } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AiSuggestionsController } from '../../../v1/ai-suggestions/controllers/ai-suggestions.controller';
import { SuggestAgentInstructionsDto } from '../../../v1/ai-suggestions/dto/agent-instructions.dto';
import { SuggestKnowledgeContentDto } from '../../../v1/ai-suggestions/dto/knowledge-suggestions.dto';
import { AiSuggestionsService } from '../../../v1/ai-suggestions/services/ai-suggestions.service';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus, NodeKind } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

const responseMock = vi.fn();

vi.mock('../../../v1/openai/openai.service', () => ({
  OpenaiService: class {
    response = responseMock;
  },
}));

let app: INestApplication;
let controller: AiSuggestionsController;
let graphsService: GraphsService;
let graphRegistry: GraphRegistry;
let aiSuggestionsService: AiSuggestionsService;
let graphDao: GraphDao;
let threadsDao: ThreadsDao;
let messagesDao: MessagesDao;

beforeAll(async () => {
  app = await createTestModule();
  controller = app.get(AiSuggestionsController);
  graphsService = app.get(GraphsService);
  graphRegistry = app.get(GraphRegistry);
  aiSuggestionsService = app.get(AiSuggestionsService);
  graphDao = app.get(GraphDao);
  threadsDao = app.get(ThreadsDao);
  messagesDao = app.get(MessagesDao);
}, 180_000);

afterAll(async () => {
  await app?.close();
}, 180_000);

describe('AiSuggestionsController (integration)', () => {
  let knowledgeGraphId: string;
  let runningGraphId: string;
  let stoppedGraphId: string;

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch {
      // Graph might not be running or may already be removed
    }

    try {
      await graphsService.delete(graphId);
    } catch {
      // Graph may already be deleted
    }
  };

  beforeAll(async () => {
    const knowledgeGraph = await graphsService.create(
      createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                instructions: 'Base instructions',
              },
            },
            {
              id: 'knowledge-1',
              template: 'simple-knowledge',
              config: { content: 'Knowledge block' },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'knowledge-1' },
          ],
        },
      }),
    );
    knowledgeGraphId = knowledgeGraph.id;
    await graphsService.run(knowledgeGraphId);

    const runningGraph = await graphsService.create(createMockGraphData());
    runningGraphId = runningGraph.id;
    await graphsService.run(runningGraphId);

    const stoppedGraph = await graphsService.create(createMockGraphData());
    stoppedGraphId = stoppedGraph.id;
  }, 180_000);

  beforeEach(() => {
    responseMock.mockClear();
  });

  afterAll(async () => {
    const graphIds = [knowledgeGraphId, runningGraphId, stoppedGraphId].filter(
      Boolean,
    );
    await Promise.all(graphIds.map((id) => cleanupGraph(id)));
  }, 180_000);

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(graphId);
  };

  describe('knowledge suggestions', () => {
    it('returns generated knowledge content for a new thread', async () => {
      await ensureGraphRunning(knowledgeGraphId);

      responseMock.mockResolvedValueOnce({
        content: 'Generated knowledge block',
        conversationId: 'knowledge-thread-1',
      });

      const result = await controller.suggestKnowledgeContent(
        knowledgeGraphId,
        'knowledge-1',
        {
          userRequest: 'Provide facts about the product',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Generated knowledge block');
      expect(result.threadId).toBe('knowledge-thread-1');
      const [payload, params] = responseMock.mock.calls[0] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      expect(payload.systemMessage).toContain(
        'You generate concise knowledge blocks',
      );
      expect(payload.message).toContain('Provide facts about the product');
      expect(payload.message).toContain('Knowledge block');
      expect(params.previous_response_id).toBeUndefined();
    });

    it('continues existing knowledge suggestion thread', async () => {
      await ensureGraphRunning(knowledgeGraphId);

      responseMock.mockResolvedValueOnce({
        content: 'Continuation content',
        conversationId: 'knowledge-thread-2',
      });

      const result = await controller.suggestKnowledgeContent(
        knowledgeGraphId,
        'knowledge-1',
        {
          userRequest: 'Continue with additional details',
          threadId: 'prev-thread',
        } as SuggestKnowledgeContentDto,
      );

      expect(result.content).toBe('Continuation content');
      expect(result.threadId).toBe('knowledge-thread-2');
      const lastCall = responseMock.mock.calls[
        responseMock.mock.calls.length - 1
      ] as [
        { systemMessage?: string; message: string },
        { previous_response_id?: string },
      ];
      const [payload, params] = lastCall;
      expect(payload.systemMessage).toBeUndefined();
      expect(payload.message).toContain('Continue with additional details');
      expect(payload.message).toContain('Knowledge block');
      expect(params.previous_response_id).toBe('prev-thread');
    });
  });

  describe('agent instructions', () => {
    it('returns suggested instructions for a running graph', async () => {
      await ensureGraphRunning(runningGraphId);
      responseMock.mockResolvedValue({
        content: 'Updated instructions (running)',
        conversationId: 'thread-running',
      });

      const response = await controller.suggestAgentInstructions(
        runningGraphId,
        'agent-1',
        {
          userRequest: 'Shorten the instructions',
          threadId: 'thread-running',
        } as SuggestAgentInstructionsDto,
      );

      expect(responseMock).toHaveBeenCalled();
      expect(response.instructions).toBe('Updated instructions (running)');
      expect(response.threadId).toBe('thread-running');
    });

    it('returns error for a non-running graph', async () => {
      await expect(
        controller.suggestAgentInstructions(stoppedGraphId, 'agent-1', {
          userRequest: 'Add safety notes',
          threadId: 'thread-stopped',
        } as SuggestAgentInstructionsDto),
      ).rejects.toThrowError();
    });

    it('returns generated threadId when not provided', async () => {
      await ensureGraphRunning(runningGraphId);
      responseMock.mockResolvedValue({
        content: 'Generated thread',
        conversationId: 'generated-thread',
      });

      const response = await controller.suggestAgentInstructions(
        runningGraphId,
        'agent-1',
        { userRequest: 'No thread provided' } as SuggestAgentInstructionsDto,
      );

      expect(responseMock).toHaveBeenCalled();
      expect(response.instructions).toBe('Generated thread');
      expect(response.threadId).toBe('generated-thread');
    });

    it(
      'runs graph with knowledge node and exposes knowledge in agent instructions',
      { timeout: 20000 },
      async () => {
        await ensureGraphRunning(knowledgeGraphId);

        const compiledGraph = await waitForCondition(
          () => Promise.resolve(graphRegistry.get(knowledgeGraphId)),
          (result) => Boolean(result?.nodes.get('agent-1')),
          { timeout: 5000, interval: 200 },
        );

        const agentNode = compiledGraph?.nodes.get('agent-1');
        expect(agentNode).toBeDefined();
        const instructions =
          (
            agentNode?.instance as {
              currentConfig?: { instructions?: string };
            }
          )?.currentConfig?.instructions ||
          (agentNode?.config as { instructions?: string })?.instructions;
        expect(typeof instructions).toBe('string');
        expect(instructions).toContain('Knowledge block');
      },
    );
  });
});

describe('AiSuggestionsService (integration)', () => {
  const createdGraphs: string[] = [];
  const createdThreads: string[] = [];

  beforeEach(() => {
    responseMock.mockClear();
  });

  afterEach(async () => {
    for (const threadId of createdThreads) {
      await messagesDao.delete({ threadId });
      await threadsDao.deleteById(threadId);
    }
    createdThreads.length = 0;

    for (const graphId of createdGraphs) {
      await graphRegistry.destroy(graphId).catch(() => undefined);
      await graphDao.deleteById(graphId);
    }
    createdGraphs.length = 0;
  });

  afterAll(async () => {
    // app closed at file-level afterAll
  });

  it(
    'analyzes a thread and calls LLM with cleaned messages',
    { timeout: 30000 },
    async () => {
      const graph = await graphDao.create({
        name: 'ai-suggestions-graph',
        description: 'test graph',
        error: null,
        version: '1.0.0',
        targetVersion: '1.0.0',
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: { name: 'Primary agent', instructions: 'Do it' },
            },
            { id: 'tool-1', template: 'search-tool', config: {} },
          ],
          edges: [{ from: 'agent-1', to: 'tool-1' }],
        },
        status: GraphStatus.Running,
        metadata: {},
        createdBy: TEST_USER_ID,
        temporary: false,
      });
      createdGraphs.push(graph.id);

      const agentInstance = {} as unknown;
      const toolInstance = {
        name: 'Search',
        description: 'Search the web',
        __instructions: 'Use it wisely',
      };

      graphRegistry.register(graph.id, {
        nodes: new Map([
          [
            'agent-1',
            {
              id: 'agent-1',
              type: NodeKind.SimpleAgent,
              template: 'simple-agent',
              instance: agentInstance,
              handle: {
                provide: async () => agentInstance,
                configure: async () => undefined,
                destroy: async () => undefined,
              },
              config: { name: 'Primary agent', instructions: 'Do it' },
            },
          ],
          [
            'tool-1',
            {
              id: 'tool-1',
              type: NodeKind.Tool,
              template: 'search-tool',
              instance: toolInstance,
              handle: {
                provide: async () => toolInstance,
                configure: async () => undefined,
                destroy: async () => undefined,
              },
              config: {},
            },
          ],
        ]),
        edges: [{ from: 'agent-1', to: 'tool-1' }],
        state: {} as never,
        destroy: async () => undefined,
        status: GraphStatus.Running,
      });

      const thread = await threadsDao.create({
        graphId: graph.id,
        createdBy: TEST_USER_ID,
        externalThreadId: `ext-thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        metadata: {},
        source: null,
        name: 'Test thread',
        status: ThreadStatus.Running,
      });
      createdThreads.push(thread.id);

      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: { role: 'system', content: 'System intro' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: { role: 'human', content: 'Hello' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: {
          role: 'ai',
          content: 'Calling tool',
          toolCalls: [
            {
              name: 'search',
              args: { query: 'hi' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
        },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'tool-1',
        message: {
          role: 'tool',
          name: 'search',
          content: { result: 'ok' },
          toolCallId: '1',
        },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'tool-1',
        message: {
          role: 'tool-shell',
          name: 'shell',
          content: { stdout: 'done', stderr: '', exitCode: 0 },
          toolCallId: '2',
        },
      });

      responseMock.mockResolvedValueOnce({
        content: 'Analysis result',
        conversationId: 'conv-123',
      });

      const result = await aiSuggestionsService.analyzeThread(thread.id, {
        userInput: 'Please check tools',
        threadId: 'conv-prev',
      });

      expect(result).toEqual({
        analysis: 'Analysis result',
        conversationId: 'conv-123',
      });

      expect(responseMock).toHaveBeenCalledTimes(1);
      const [payload, params] = responseMock.mock.calls[0] as [
        { message: string },
        { previous_response_id?: string },
      ];
      expect(params.previous_response_id).toBe('conv-prev');
      expect(payload.message).toBe('Please check tools');
    },
  );
});
