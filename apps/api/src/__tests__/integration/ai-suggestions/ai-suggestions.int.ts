import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AiSuggestionsController } from '../../../v1/ai-suggestions/controllers/ai-suggestions.controller';
import { SuggestAgentInstructionsDto } from '../../../v1/ai-suggestions/dto/ai-suggestions.dto';
import { AiSuggestionsService } from '../../../v1/ai-suggestions/services/ai-suggestions.service';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import {
  GraphStatus,
  MessageRole,
  NodeKind,
} from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

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
    const runningGraph = await graphsService.create(createMockGraphData());
    runningGraphId = runningGraph.id;
    await graphsService.run(runningGraphId);

    const stoppedGraph = await graphsService.create(createMockGraphData());
    stoppedGraphId = stoppedGraph.id;
  }, 180_000);

  afterAll(async () => {
    const graphIds = [runningGraphId, stoppedGraphId].filter(Boolean);
    await Promise.all(graphIds.map((id) => cleanupGraph(id)));
  }, 180_000);

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(graphId);
  };

  describe('agent instructions', () => {
    it('returns suggested instructions for a running graph', async () => {
      await ensureGraphRunning(runningGraphId);

      const response = await controller.suggestAgentInstructions(
        runningGraphId,
        'agent-1',
        {
          userRequest: 'Shorten the instructions',
          threadId: 'thread-running',
        } as SuggestAgentInstructionsDto,
      );

      expect(response.instructions.length).toBeGreaterThan(0);
      expect(response.threadId).toBeDefined();
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

      const response = await controller.suggestAgentInstructions(
        runningGraphId,
        'agent-1',
        { userRequest: 'No thread provided' } as SuggestAgentInstructionsDto,
      );

      expect(response.instructions.length).toBeGreaterThan(0);
      expect(response.threadId).toBeDefined();
    });
  });
});

describe('AiSuggestionsService (integration)', () => {
  const createdGraphs: string[] = [];
  const createdThreads: string[] = [];

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
        message: { role: MessageRole.System, content: 'System intro' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: { role: MessageRole.Human, content: 'Hello' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: {
          role: MessageRole.AI,
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
          role: MessageRole.Tool,
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
          role: MessageRole.ToolShell,
          name: 'shell',
          content: { stdout: 'done', stderr: '', exitCode: 0 },
          toolCallId: '2',
        },
      });

      const result = await aiSuggestionsService.analyzeThread(thread.id, {
        userInput: 'Please check tools',
        threadId: 'conv-prev',
      });

      expect(result.analysis.length).toBeGreaterThan(0);
      expect(result.conversationId).toBeDefined();
    },
  );
});
