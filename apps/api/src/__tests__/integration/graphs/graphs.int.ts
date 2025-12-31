import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { cloneDeep } from 'lodash';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EntityUUIDSchema } from '../../../utils/dto/misc.dto';
import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import {
  CreateGraphDto,
  UpdateGraphDto,
} from '../../../v1/graphs/dto/graphs.dto';
import {
  GraphNodeSchemaType,
  GraphStatus,
} from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { wait } from '../../test-utils';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const TEST_AGENT_NODE_ID = 'agent-1';
const TEST_TRIGGER_NODE_ID = 'trigger-1';
const SHELL_NODE_ID = 'shell-1';
const RUNTIME_NODE_ID = 'runtime-1';
const NON_EXISTENT_GRAPH_ID = '00000000-0000-0000-0000-000000000000';

const COMMAND_AGENT_INSTRUCTIONS =
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, describe what happened. If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

describe('Graphs Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let graphRegistry: GraphRegistry;
  const createdGraphIds: string[] = [];
  let commandGraphId: string;

  const registerGraph = (graphId: string) => {
    if (!createdGraphIds.includes(graphId)) {
      createdGraphIds.push(graphId);
    }
  };

  const unregisterGraph = (graphId: string) => {
    const index = createdGraphIds.indexOf(graphId);
    if (index >= 0) {
      createdGraphIds.splice(index, 1);
    }
  };

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        (error.errorCode !== 'GRAPH_NOT_FOUND' &&
          error.errorCode !== 'GRAPH_NOT_RUNNING')
      ) {
        throw error;
      }
    }

    try {
      await graphsService.delete(graphId);
    } catch (error: unknown) {
      if (
        !(error instanceof BaseException) ||
        error.errorCode !== 'GRAPH_NOT_FOUND'
      ) {
        throw error;
      }
    }
  };

  const waitForGraphStatus = async (
    graphId: string,
    status: GraphStatus,
    timeoutMs = 60000,
  ) => {
    return waitForCondition(
      () => graphsService.findById(graphId),
      (graph) => graph.status === status,
      { timeout: timeoutMs, interval: 1000 },
    );
  };

  const waitForThreadStatus = async (
    threadId: string,
    statuses: ThreadStatus[],
    timeoutMs = 60000,
  ) => {
    return waitForCondition(
      () => threadsService.getThreadByExternalId(threadId),
      (thread) => statuses.includes(thread.status),
      { timeout: timeoutMs, interval: 1000 },
    );
  };

  const createCommandGraphData = (): CreateGraphDto => ({
    name: `Command Graph ${Date.now()}`,
    description: 'Graph with shell runtime for destroy-stop scenarios',
    temporary: true,
    schema: {
      nodes: [
        {
          id: TEST_TRIGGER_NODE_ID,
          template: 'manual-trigger',
          config: {},
        },
        {
          id: TEST_AGENT_NODE_ID,
          template: 'simple-agent',
          config: {
            instructions: COMMAND_AGENT_INSTRUCTIONS,
            name: 'Test Agent',
            description: 'Test agent description',
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
            invokeModelName: 'gpt-5-mini',
            invokeModelReasoningEffort: ReasoningEffort.None,
            enforceToolUsage: true,
            maxIterations: 50,
          } satisfies SimpleAgentSchemaType,
        },
        {
          id: SHELL_NODE_ID,
          template: 'shell-tool',
          config: {},
        },
        {
          id: RUNTIME_NODE_ID,
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: 'python:3.11-slim',
            env: {},
          },
        },
      ],
      edges: [
        { from: TEST_TRIGGER_NODE_ID, to: TEST_AGENT_NODE_ID },
        { from: TEST_AGENT_NODE_ID, to: SHELL_NODE_ID },
        { from: SHELL_NODE_ID, to: RUNTIME_NODE_ID },
      ],
    },
  });

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
    graphRegistry = app.get<GraphRegistry>(GraphRegistry);
  });

  afterAll(async () => {
    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (graphId) {
        await cleanupGraph(graphId);
      }
    }
    await app.close();
  }, 180_000);

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(graphId);
    await waitForGraphStatus(graphId, GraphStatus.Running);
  };

  const restartGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(graphId);
    } catch {
      // best effort
    }
    await ensureGraphRunning(graphId);
  };

  describe('graph creation', () => {
    it('creates a new graph with the default schema', async () => {
      const graphData = createMockGraphData();

      const response = await graphsService.create(graphData);
      registerGraph(response.id);

      expect(response.id).toBeDefined();
      expect(response.status).toBe(GraphStatus.Created);
      expect(response.version).toBe('1.0.0');
      expect(response.targetVersion).toBe('1.0.0');
      expect(response.schema).toMatchObject(graphData.schema);
    });

    it('creates a graph without optional description', async () => {
      const graphData = createMockGraphData({
        description: undefined,
        temporary: false,
      });

      const response = await graphsService.create(graphData);
      registerGraph(response.id);

      expect(response.description ?? null).toBeNull();
      expect(response.temporary).toBe(false);
    });

    it('rejects graphs with duplicate node identifiers', async () => {
      const invalidData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'duplicate-node',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'duplicate-node',
              template: 'simple-agent',
              config: {
                instructions: 'Duplicate test',
                invokeModelName: 'gpt-5-mini',
                invokeModelReasoningEffort: ReasoningEffort.None,
                summarizeMaxTokens: 1000,
                summarizeKeepTokens: 100,
              },
            },
          ],
          edges: [],
        },
      });

      await expect(graphsService.create(invalidData)).rejects.toMatchObject({
        errorCode: 'GRAPH_DUPLICATE_NODE',
        statusCode: 400,
      });
    });

    it('rejects graphs that reference unknown templates', async () => {
      const invalidData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'unknown-template',
              config: {},
            },
          ],
          edges: [],
        },
      });

      await expect(graphsService.create(invalidData)).rejects.toMatchObject({
        errorCode: 'TEMPLATE_NOT_REGISTERED',
        statusCode: 400,
      });
    });

    it('rejects graphs with edges pointing to non-existent target nodes', async () => {
      const invalidData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            {
              from: 'node-1',
              to: 'missing-node',
            },
          ],
        },
      });

      await expect(graphsService.create(invalidData)).rejects.toMatchObject({
        errorCode: 'GRAPH_EDGE_NOT_FOUND',
        statusCode: 400,
      });
    });

    it('rejects graphs with edges pointing to non-existent source nodes', async () => {
      const invalidData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            {
              from: 'missing-node',
              to: 'node-1',
            },
          ],
        },
      });

      await expect(graphsService.create(invalidData)).rejects.toMatchObject({
        errorCode: 'GRAPH_EDGE_NOT_FOUND',
        statusCode: 400,
      });
    });

    it('rejects graphs with invalid template configuration', async () => {
      const graphData = createMockGraphData();
      const invalidAgentSchema = cloneDeep(graphData.schema);

      invalidAgentSchema.nodes = invalidAgentSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: { invalid: 'config' },
            }
          : node,
      );

      await expect(
        graphsService.create({
          ...graphData,
          schema: invalidAgentSchema,
        }),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_TEMPLATE_CONFIG',
        statusCode: 400,
      });
    });
  });

  describe('graph retrieval', () => {
    it('returns all graphs including newly created ones', async () => {
      const graphA = await graphsService.create(createMockGraphData());
      const graphB = await graphsService.create(createMockGraphData());
      registerGraph(graphA.id);
      registerGraph(graphB.id);

      const graphs = await graphsService.getAll();

      const ids = graphs.map((graph) => graph.id);
      expect(ids).toContain(graphA.id);
      expect(ids).toContain(graphB.id);
    });

    it('fetches a graph by id', async () => {
      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      const fetched = await graphsService.findById(graph.id);
      expect(fetched.id).toBe(graph.id);
      expect(fetched.schema).toMatchObject(graph.schema);
    });

    it('throws an error when graph is missing', async () => {
      await expect(
        graphsService.findById(NON_EXISTENT_GRAPH_ID),
      ).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('validates UUID params the same way the controller layer does', () => {
      const result = EntityUUIDSchema.safeParse({ id: 'invalid-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('graph updates', () => {
    it('updates mutable fields (partial + full) without touching schema or version', async () => {
      const graphForPartial = await graphsService.create(createMockGraphData());
      const graphForFull = await graphsService.create(createMockGraphData());
      registerGraph(graphForPartial.id);
      registerGraph(graphForFull.id);

      const partialUpdate: UpdateGraphDto = {
        name: 'Partially Updated Graph',
        currentVersion: graphForPartial.version,
      };

      const partialResponse = await graphsService.update(
        graphForPartial.id,
        partialUpdate,
      );
      expect(partialResponse.revision).toBeDefined();
      expect(partialResponse.graph.version).toBe(graphForPartial.version);
      expect(partialResponse.graph.schema).toMatchObject(graphForPartial.schema);

      // Mutable updates are represented as a revision (tracked & applied consistently).
      expect(partialResponse.revision!.toVersion).toBe('1.0.1');
      expect(partialResponse.graph.targetVersion).toBe('1.0.1');
      expect(partialResponse.revision!.newConfig.name).toBe(partialUpdate.name);
      expect(partialResponse.revision!.newConfig.description).toBe(
        graphForPartial.description ?? null,
      );
      expect(partialResponse.revision!.newConfig.schema).toMatchObject(
        graphForPartial.schema,
      );

      const fullUpdate: UpdateGraphDto = {
        name: 'Updated Graph Name',
        description: 'Updated description from integration test',
        currentVersion: graphForFull.version,
      };

      const fullResponse = await graphsService.update(graphForFull.id, fullUpdate);
      expect(fullResponse.revision).toBeDefined();
      expect(fullResponse.graph.version).toBe(graphForFull.version);
      expect(fullResponse.graph.schema).toMatchObject(graphForFull.schema);

      expect(fullResponse.revision!.toVersion).toBe('1.0.1');
      expect(fullResponse.graph.targetVersion).toBe('1.0.1');
      expect(fullResponse.revision!.newConfig.name).toBe(fullUpdate.name);
      expect(fullResponse.revision!.newConfig.description).toBe(
        fullUpdate.description ?? null,
      );
      expect(fullResponse.revision!.newConfig.schema).toMatchObject(
        graphForFull.schema,
      );
    });

    it('throws when updating a non-existent graph', async () => {
      const updatePayload: UpdateGraphDto = {
        name: 'Missing Graph',
        currentVersion: '0.0.0',
      };

      await expect(
        graphsService.update(NON_EXISTENT_GRAPH_ID, updatePayload),
      ).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('increments version on schema change and rejects stale edits (version conflict)', async () => {
      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      const updatedSchema = cloneDeep(graph.schema);
      updatedSchema.nodes = updatedSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Schema update via integration test',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const response = await graphsService.update(graph.id, {
        schema: updatedSchema,
        currentVersion: graph.version,
      });

      // Schema edits create a revision and advance targetVersion (head), but the graph's applied
      // version remains unchanged until the revision is applied by the background worker.
      expect(response.revision).toBeDefined();
      expect(response.graph.version).toBe('1.0.0');
      expect(response.graph.targetVersion).toBe('1.0.1');

      expect(response.revision!.toVersion).toBe('1.0.1');
      const agentNode = response.revision!.newConfig.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect((agentNode?.config as SimpleAgentSchemaType).instructions).toBe(
        'Schema update via integration test',
      );

      const staleSchema = cloneDeep(updatedSchema);
      staleSchema.nodes = staleSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Stale update should fail',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      await expect(
        graphsService.update(graph.id, {
          schema: staleSchema,
          currentVersion: graph.version,
        }),
      ).rejects.toMatchObject({
        // This is a stale edit against a newer head (targetVersion), so the merge should conflict.
        errorCode: 'MERGE_CONFLICT',
        statusCode: 400,
      });
    });
  });

  describe('running graphs', () => {
    it('runs a graph, registers it, and prevents re-running while already running', async () => {
      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      const runResponse = await graphsService.run(graph.id);
      expect(runResponse.status).toBe(GraphStatus.Running);

      await waitForGraphStatus(graph.id, GraphStatus.Running);
      expect(graphRegistry.get(graph.id)).toBeDefined();

      await expect(graphsService.run(graph.id)).rejects.toMatchObject({
        errorCode: 'GRAPH_ALREADY_RUNNING',
        statusCode: 400,
      });
    });

    it('throws when trying to run a missing graph', async () => {
      await expect(
        graphsService.run(NON_EXISTENT_GRAPH_ID),
      ).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  describe('destroying graphs', () => {
    it(
      'stops a running graph and returns it in the stopped state',
      { timeout: 60000 },
      async () => {
        const graph = await graphsService.create(createMockGraphData());
        registerGraph(graph.id);

        await graphsService.run(graph.id);
        await waitForGraphStatus(graph.id, GraphStatus.Running);
        expect(graphRegistry.get(graph.id)).toBeDefined();

        const destroyResponse = await graphsService.destroy(graph.id);
        expect(destroyResponse.status).toBe(GraphStatus.Stopped);
        expect(graphRegistry.get(graph.id)).toBeUndefined();

        const refreshed = await graphsService.findById(graph.id);
        expect(refreshed.status).toBe(GraphStatus.Stopped);
      },
    );

    it('throws when destroying a missing graph', async () => {
      await expect(
        graphsService.destroy(NON_EXISTENT_GRAPH_ID),
      ).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });
  });

  describe('deleting graphs', () => {
    it('deletes a graph permanently', async () => {
      const graph = await graphsService.create(createMockGraphData());
      registerGraph(graph.id);

      await graphsService.delete(graph.id);
      unregisterGraph(graph.id);

      await expect(graphsService.findById(graph.id)).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });

    it('throws when deleting a missing graph', async () => {
      await expect(
        graphsService.delete(NON_EXISTENT_GRAPH_ID),
      ).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
        statusCode: 404,
      });
    });

    it(
      'stops a running graph before deleting it',
      { timeout: 60000 },
      async () => {
        const graph = await graphsService.create(createMockGraphData());
        registerGraph(graph.id);

        await graphsService.run(graph.id);
        await waitForGraphStatus(graph.id, GraphStatus.Running);
        expect(graphRegistry.get(graph.id)).toBeDefined();

        await graphsService.delete(graph.id);
        unregisterGraph(graph.id);
        expect(graphRegistry.get(graph.id)).toBeUndefined();

        await expect(graphsService.findById(graph.id)).rejects.toMatchObject({
          errorCode: 'GRAPH_NOT_FOUND',
          statusCode: 404,
        });
      },
    );
  });

  describe('destroying graphs with active executions', () => {
    beforeAll(async () => {
      const graph = await graphsService.create(createCommandGraphData());
      commandGraphId = graph.id;
      registerGraph(commandGraphId);
    });

    it(
      'stops active execution and marks the thread as stopped',
      { timeout: 120000 },
      async () => {
        await restartGraph(commandGraphId);

        const execution = await graphsService.executeTrigger(
          commandGraphId,
          TEST_TRIGGER_NODE_ID,
          {
            messages: ['Run this command: sleep 100 && echo "interrupt me"'],
            async: true,
            threadSubId: uniqueThreadSubId('destroy-active'),
          },
        );

        await waitForThreadStatus(
          execution.externalThreadId,
          [ThreadStatus.Running],
          60000,
        );

        const destroyResponse = await graphsService.destroy(commandGraphId);
        expect(destroyResponse.status).toBe(GraphStatus.Stopped);

        const thread = await waitForThreadStatus(
          execution.externalThreadId,
          [ThreadStatus.Stopped],
          60000,
        );
        expect(thread.status).toBe(ThreadStatus.Stopped);

        const persistedThread = await threadsService.getThreadByExternalId(
          execution.externalThreadId,
        );

        const messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(persistedThread.id, {
              limit: 50,
              offset: 0,
            }),
          (msgs) =>
            msgs.some(
              (entry) =>
                entry.message.role === 'system' &&
                typeof entry.message.content === 'string' &&
                entry.message.content.includes(
                  'Graph execution was stopped for agent Test Agent',
                ),
            ),
          { timeout: 60000, interval: 1000 },
        );

        const stopMessages = messages.filter(
          (entry) =>
            entry.message.role === 'system' &&
            typeof entry.message.content === 'string' &&
            entry.message.content.includes(
              'Graph execution was stopped for agent Test Agent',
            ),
        );

        expect(stopMessages).toHaveLength(1);
        expect(stopMessages[0]?.message.content).toContain(
          'Graph execution was stopped for agent Test Agent',
        );
      },
    );

    it(
      'stops multiple concurrent agent executions when destroyed',
      { timeout: 120000 },
      async () => {
        await restartGraph(commandGraphId);

        const executions = await Promise.all(
          ['First concurrent execution', 'Second concurrent execution'].map(
            (message) =>
              graphsService.executeTrigger(
                commandGraphId,
                TEST_TRIGGER_NODE_ID,
                {
                  messages: [message],
                  async: true,
                  threadSubId: uniqueThreadSubId('destroy-concurrent'),
                },
              ),
          ),
        );

        await wait(1000);
        await graphsService.destroy(commandGraphId);

        for (const execution of executions) {
          const thread = await waitForThreadStatus(execution.externalThreadId, [
            ThreadStatus.Stopped,
            ThreadStatus.NeedMoreInfo,
          ]);
          expect([ThreadStatus.Stopped, ThreadStatus.NeedMoreInfo]).toContain(
            thread.status,
          );
        }
      },
    );

    it(
      'allows destroy even when no agent is actively executing',
      { timeout: 120000 },
      async () => {
        await restartGraph(commandGraphId);

        const destroyResponse = await graphsService.destroy(commandGraphId);
        expect(destroyResponse.status).toBe(GraphStatus.Stopped);
        expect(graphRegistry.get(commandGraphId)).toBeUndefined();
      },
    );
  });
});
