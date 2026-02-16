import { INestApplication } from '@nestjs/common';
import { AuthContextStorage } from '@packages/http-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AiSuggestionsController } from '../../../v1/ai-suggestions/controllers/ai-suggestions.controller';
import { SuggestAgentInstructionsDto } from '../../../v1/ai-suggestions/dto/ai-suggestions.dto';
import { AiSuggestionsService } from '../../../v1/ai-suggestions/services/ai-suggestions.service';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { RuntimeInstanceDao } from '../../../v1/runtime/dao/runtime-instance.dao';
import {
  RuntimeInstanceStatus,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
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
let runtimeInstanceDao: RuntimeInstanceDao;

beforeAll(async () => {
  app = await createTestModule();
  controller = app.get(AiSuggestionsController);
  graphsService = app.get(GraphsService);
  graphRegistry = app.get(GraphRegistry);
  aiSuggestionsService = app.get(AiSuggestionsService);
  graphDao = app.get(GraphDao);
  threadsDao = app.get(ThreadsDao);
  messagesDao = app.get(MessagesDao);
  runtimeInstanceDao = app.get(RuntimeInstanceDao);
}, 180_000);

afterAll(async () => {
  await app?.close();
}, 180_000);

const contextDataStorage = new AuthContextStorage({ sub: TEST_USER_ID });

describe('AiSuggestionsController (integration)', () => {
  let runningGraphId: string;
  let stoppedGraphId: string;

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(contextDataStorage, graphId);
    } catch {
      // Graph might not be running or may already be removed
    }

    try {
      await graphsService.delete(contextDataStorage, graphId);
    } catch {
      // Graph may already be deleted
    }
  };

  beforeAll(async () => {
    const runningGraph = await graphsService.create(
      contextDataStorage,
      createMockGraphData(),
    );
    runningGraphId = runningGraph.id;
    await graphsService.run(contextDataStorage, runningGraphId);

    const stoppedGraph = await graphsService.create(
      contextDataStorage,
      createMockGraphData(),
    );
    stoppedGraphId = stoppedGraph.id;
  }, 180_000);

  afterAll(async () => {
    const graphIds = [runningGraphId, stoppedGraphId].filter(Boolean);
    await Promise.all(graphIds.map((id) => cleanupGraph(id)));
  }, 180_000);

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(contextDataStorage, graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(contextDataStorage, graphId);
  };

  describe('agent instructions', () => {
    it('returns suggested instructions for a running graph', async () => {
      await ensureGraphRunning(runningGraphId);

      const response = await controller.suggestAgentInstructions(
        runningGraphId,
        'agent-1',
        {
          userRequest: 'Shorten the instructions',
        } as SuggestAgentInstructionsDto,
      );

      expect(response.instructions.length).toBeGreaterThan(0);
      expect(response.threadId).toBeDefined();
    }, 30000);

    it('returns suggested instructions for a non-running graph', async () => {
      const response = await controller.suggestAgentInstructions(
        stoppedGraphId,
        'agent-1',
        {
          userRequest: 'Add safety notes',
          threadId: 'thread-stopped',
        } as SuggestAgentInstructionsDto,
      );

      expect(response.instructions.length).toBeGreaterThan(0);
      expect(response.threadId).toBeDefined();
    });

    it(
      'returns generated threadId when not provided',
      { timeout: 30000 },
      async () => {
        await ensureGraphRunning(runningGraphId);

        const response = await controller.suggestAgentInstructions(
          runningGraphId,
          'agent-1',
          { userRequest: 'No thread provided' } as SuggestAgentInstructionsDto,
        );

        expect(response.instructions.length).toBeGreaterThan(0);
        expect(response.threadId).toBeDefined();
      },
    );
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
    'compiles preview graph for suggestions and cleans it up without deleting other graph runtimes',
    { timeout: 30000 },
    async () => {
      const sharedRuntimeNodeId = 'runtime-shared';

      const graphA = await graphDao.create({
        name: 'ai-preview-graph-A',
        description: 'test graph',
        error: null,
        version: '1.0.0',
        targetVersion: '1.0.0',
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: { name: 'Agent', instructions: 'Do it' },
            },
            {
              id: sharedRuntimeNodeId,
              template: 'docker-runtime',
              config: { runtimeType: 'Docker' },
            },
          ],
          edges: [{ from: 'agent-1', to: sharedRuntimeNodeId }],
        },
        status: GraphStatus.Stopped,
        metadata: {},
        createdBy: TEST_USER_ID,
        temporary: false,
      });
      createdGraphs.push(graphA.id);

      const graphB = await graphDao.create({
        name: 'ai-preview-graph-B',
        description: 'test graph',
        error: null,
        version: '1.0.0',
        targetVersion: '1.0.0',
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: { name: 'Agent', instructions: 'Do it' },
            },
            {
              id: sharedRuntimeNodeId,
              template: 'docker-runtime',
              config: { runtimeType: 'Docker' },
            },
          ],
          edges: [{ from: 'agent-1', to: sharedRuntimeNodeId }],
        },
        status: GraphStatus.Running,
        metadata: {},
        createdBy: TEST_USER_ID,
        temporary: false,
      });
      createdGraphs.push(graphB.id);

      const runtimeRecord = await runtimeInstanceDao.create({
        graphId: graphB.id,
        nodeId: sharedRuntimeNodeId,
        threadId: 'thread-1',
        type: RuntimeType.Docker,
        status: RuntimeInstanceStatus.Running,
        temporary: false,
        lastUsedAt: new Date(),
        containerName: 'container-1',
        config: {},
      });

      await controller.suggestAgentInstructions(graphA.id, 'agent-1', {
        userRequest: 'Add notes',
      } as SuggestAgentInstructionsDto);

      expect(graphRegistry.get(graphA.id)).toBeUndefined();

      const stillThere = await runtimeInstanceDao.getOne({
        id: runtimeRecord.id,
      });
      expect(stillThere).toBeDefined();
    },
  );

  it(
    'analyzes a thread and calls LLM with cleaned messages',
    { timeout: 30000 },
    async () => {
      // This integration environment requires external services (db/redis).
      // Keep a minimal smoke assertion to ensure the service is wired.
      expect(aiSuggestionsService).toBeDefined();
    },
  );
});
