import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { cloneDeep } from 'lodash';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import {
  GraphNodeSchemaType,
  GraphRevisionStatus,
  GraphStatus,
} from '../../../v1/graphs/graphs.types';
import { GraphRevisionService } from '../../../v1/graphs/services/graph-revision.service';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { wait } from '../../test-utils';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const TEST_AGENT_NODE_ID = 'agent-1';

const COMMAND_AGENT_INSTRUCTIONS =
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, call the finish tool with the stdout (and stderr if present). If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

describe('Graph Revisions Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let revisionsService: GraphRevisionService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

  const waitForGraphToBeRunning = async (id: string, timeoutMs = 60000) => {
    const startedAt = Date.now();

    while (true) {
      const graph = await graphsService.findById(id);

      if (graph.status === GraphStatus.Running) {
        return graph;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${id} did not reach running status within ${timeoutMs}ms (current status: ${graph.status})`,
        );
      }

      await wait(1000);
    }
  };

  const waitForRevisionStatus = async (
    graphId: string,
    revisionId: string,
    status: GraphRevisionStatus | GraphRevisionStatus[],
    timeoutMs = 60000,
  ) => {
    const startedAt = Date.now();
    const statuses = Array.isArray(status) ? status : [status];

    while (true) {
      const revision = await revisionsService.getRevisionById(
        graphId,
        revisionId,
      );

      if (revision && statuses.includes(revision.status)) {
        return revision;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Revision ${revisionId} did not reach status [${statuses.join(', ')}] within ${timeoutMs}ms (current: ${revision?.status || 'not found'})`,
        );
      }

      await wait(1000);
    }
  };

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 60000,
  ) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);

    return waitForCondition(
      () => threadsService.getThreadById(thread.id),
      (t) =>
        [
          ThreadStatus.Done,
          ThreadStatus.Stopped,
          ThreadStatus.NeedMoreInfo,
        ].includes(t.status),
      { timeout: timeoutMs, interval: 1000 },
    );
  };

  const isAiThreadMessage = (
    message: ThreadMessageDto['message'],
  ): message is Extract<ThreadMessageDto['message'], { role: 'ai' }> =>
    message.role === 'ai';

  type ShellThreadMessage =
    | Extract<ThreadMessageDto['message'], { role: 'tool-shell' }>
    | Extract<ThreadMessageDto['message'], { role: 'tool' }>;

  const isShellThreadMessage = (
    message: ThreadMessageDto['message'],
  ): message is ShellThreadMessage =>
    (message.role === 'tool-shell' || message.role === 'tool') &&
    message.name === 'shell';

  const getThreadMessages = async (
    externalThreadId: string,
  ): Promise<ThreadMessageDto[]> => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);
    return threadsService.getThreadMessages(thread.id);
  };

  const waitForAppliedRevisions = async (
    graphId: string,
    expectedCount: number,
  ) => {
    await waitForCondition(
      () => revisionsService.getRevisions(graphId, { limit: expectedCount }),
      (revisions) =>
        revisions.filter(
          (revision) => revision.status === GraphRevisionStatus.Applied,
        ).length >= expectedCount,
      { timeout: 60000, interval: 1000 },
    );
  };

  const findShellExecution = (
    messages: ThreadMessageDto[],
  ): {
    toolName?: string;
    toolCallId?: string;
    result?: {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  } => {
    const aiMessage = messages.find(
      (
        message,
      ): message is ThreadMessageDto & {
        message: Extract<ThreadMessageDto['message'], { role: 'ai' }>;
      } => isAiThreadMessage(message.message),
    )?.message;

    const shellMessage = messages.find(
      (
        message,
      ): message is ThreadMessageDto & {
        message: Extract<ThreadMessageDto['message'], { role: 'tool-shell' }>;
      } => isShellThreadMessage(message.message),
    )?.message;

    const shellToolCall = aiMessage?.toolCalls?.find(
      (toolCall) => toolCall.name === 'shell',
    );

    const result =
      shellMessage?.role === 'tool-shell'
        ? shellMessage.content
        : shellMessage?.role === 'tool'
          ? (shellMessage.content as {
              exitCode?: number;
              stdout?: string;
              stderr?: string;
            })
          : undefined;

    return {
      toolName: shellToolCall?.name ?? shellMessage?.name,
      toolCallId: shellToolCall?.id ?? shellMessage?.toolCallId,
      result:
        result &&
        typeof result.exitCode === 'number' &&
        typeof result.stdout === 'string' &&
        typeof result.stderr === 'string'
          ? {
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            }
          : undefined,
    };
  };

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    revisionsService = app.get<GraphRevisionService>(GraphRevisionService);
    threadsService = app.get<ThreadsService>(ThreadsService);
  });

  afterAll(async () => {
    await Promise.all(
      createdGraphIds.map(async (graphId) => {
        try {
          await graphsService.destroy(graphId);
        } catch (error: unknown) {
          if (
            error instanceof BaseException &&
            error.errorCode !== 'GRAPH_NOT_RUNNING' &&
            error.errorCode !== 'GRAPH_NOT_FOUND'
          ) {
            console.error(
              `Unexpected error destroying graph ${graphId}:`,
              error,
            );
            throw error;
          }
        }
        try {
          await graphsService.delete(graphId);
        } catch (error: unknown) {
          if (
            error instanceof BaseException &&
            error.errorCode !== 'GRAPH_NOT_FOUND'
          ) {
            console.error(`Unexpected error deleting graph ${graphId}:`, error);
            throw error;
          }
        }
      }),
    );

    await app.close();
  }, 120000);

  it('applies a revision to a running graph', { timeout: 60000 }, async () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions for live revision';

    const createResponse = await graphsService.create(graphData);
    expect(createResponse.version).toBe('1.0.0');
    expect(createResponse.status).toBe(GraphStatus.Created);
    const graphId = createResponse.id;
    createdGraphIds.push(graphId);

    await graphsService.run(graphId);
    await waitForGraphToBeRunning(graphId);

    const updatedSchema = cloneDeep(createResponse.schema);
    updatedSchema.nodes = updatedSchema.nodes.map((node) =>
      node.id === TEST_AGENT_NODE_ID
        ? {
            ...node,
            config: {
              ...node.config,
              instructions: newInstructions,
            },
          }
        : node,
    );
    const updateResponse = await graphsService.update(graphId, {
      schema: updatedSchema,
      currentVersion: createResponse.version,
    });

    expect(updateResponse.revision).toBeDefined();
    expect(updateResponse.revision!.status).toBe(GraphRevisionStatus.Pending);
    expect(updateResponse.revision!.toVersion).toBe('1.0.1');
    const revisionId = updateResponse.revision!.id;

    const revision = await waitForRevisionStatus(
      graphId,
      revisionId,
      GraphRevisionStatus.Applied,
    );

    expect(revision.status).toBe(GraphRevisionStatus.Applied);
    expect(revision.error).toBeUndefined();

    const updatedGraph = await graphsService.findById(graphId);
    expect(updatedGraph.version).toBe('1.0.1');
    expect(updatedGraph.targetVersion).toBe('1.0.1');

    const agentNode = updatedGraph.schema.nodes.find(
      (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
    );
    expect(agentNode?.config.instructions).toBe(newInstructions);
  });

  it(
    'processes queued revisions sequentially',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const firstSchema = cloneDeep(createResponse.schema);
      firstSchema.nodes = firstSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'First revision instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const firstUpdateResponse = await graphsService.update(graphId, {
        schema: firstSchema,
        currentVersion: createResponse.version,
      });

      expect(firstUpdateResponse.revision).toBeDefined();
      const firstRevision = firstUpdateResponse.revision!;
      expect(firstRevision.toVersion).toBe('1.0.1');

      await waitForRevisionStatus(
        graphId,
        firstRevision.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterFirst = await graphsService.findById(graphId);
      expect(graphAfterFirst.version).toBe('1.0.1');

      const secondSchema = cloneDeep(graphAfterFirst.schema);
      secondSchema.nodes = secondSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Second revision overwrites first',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const secondUpdateResponse = await graphsService.update(graphId, {
        schema: secondSchema,
        currentVersion: graphAfterFirst.version,
      });

      expect(secondUpdateResponse.revision).toBeDefined();
      const secondRevision = secondUpdateResponse.revision!;
      expect(secondRevision.toVersion).toBe('1.0.2');

      await waitForRevisionStatus(
        graphId,
        secondRevision.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(graphId);
      expect(finalGraph.version).toBe('1.0.2');
      expect(finalGraph.targetVersion).toBe('1.0.2');

      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(
        'Second revision overwrites first',
      );
    },
  );

  it(
    'merges non-conflicting concurrent edits from multiple users',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User A instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      const userARevisionId = userAUpdate.revision?.id;

      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                invokeModelName: 'gpt-5',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      const userBRevisionId = userBUpdate.revision?.id;

      const revisionIds = [userARevisionId, userBRevisionId].filter(
        (id): id is string => typeof id === 'string',
      );

      for (const revisionId of revisionIds) {
        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );
      }

      if (revisionIds.length < 2) {
        await waitForAppliedRevisions(graphId, 2);
      }

      await waitForCondition(
        () => graphsService.findById(graphId),
        (graph) => graph.version === '1.0.2',
        { timeout: 60000, interval: 1000 },
      );

      await wait(500);

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('User A instructions');
      expect((agentNode?.config as SimpleAgentSchemaType).invokeModelName).toBe(
        'gpt-5',
      );
    },
  );

  it(
    'rejects stale edits and allows refresh-retry flow',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User A instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      await waitForRevisionStatus(
        graphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUserA = await graphsService.findById(graphId);
      const currentVersion = graphAfterUserA.version;

      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User B conflicting instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      await expect(
        graphsService.update(graphId, {
          schema: userBSchema,
          currentVersion: baseVersion,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'VERSION_CONFLICT',
      });

      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: currentVersion,
      });

      expect(userBUpdate.revision).toBeDefined();

      await waitForRevisionStatus(
        graphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(
        'User B conflicting instructions',
      );
    },
  );

  it(
    'handles three users with cascading changes',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      let currentVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      const user1Schema = cloneDeep(baseSchema);
      user1Schema.nodes = user1Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                temperature: 0.7,
              },
            }
          : node,
      );

      const user1Update = await graphsService.update(graphId, {
        schema: user1Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user1Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUser1 = await graphsService.findById(graphId);
      currentVersion = graphAfterUser1.version;

      const user2Schema = cloneDeep(graphAfterUser1.schema);
      user2Schema.nodes = user2Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                max_tokens: 2000,
              },
            }
          : node,
      );

      const user2Update = await graphsService.update(graphId, {
        schema: user2Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user2Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUser2 = await graphsService.findById(graphId);
      currentVersion = graphAfterUser2.version;

      const user3Schema = cloneDeep(graphAfterUser2.schema);
      user3Schema.nodes = user3Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: 'Cascaded instructions from User 3',
              },
            }
          : node,
      );

      const user3Update = await graphsService.update(graphId, {
        schema: user3Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user3Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.temperature).toBe(0.7);
      expect(agentNode?.config.max_tokens).toBe(2000);
      expect(agentNode?.config.instructions).toBe(
        'Cascaded instructions from User 3',
      );
    },
  );

  it(
    'rejects concurrent conflicting edits to same field',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      const schema1 = cloneDeep(baseSchema);
      schema1.nodes = schema1.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'First edit',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const firstResponse = await graphsService.update(graphId, {
        schema: schema1,
        currentVersion: baseVersion,
      });
      expect(firstResponse.revision).toBeDefined();

      const schema2 = cloneDeep(baseSchema);
      schema2.nodes = schema2.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Second conflicting edit',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      await expect(
        graphsService.update(graphId, {
          schema: schema2,
          currentVersion: baseVersion,
        }),
      ).rejects.toMatchObject({
        errorCode: 'MERGE_CONFLICT',
        statusCode: 400,
      });

      await waitForRevisionStatus(
        graphId,
        firstResponse.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('First edit');
    },
  );

  it(
    'handles truly sequential edits when waiting between submissions',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const revisionIds: string[] = [];

      for (let i = 1; i <= 3; i++) {
        const graph = await graphsService.findById(graphId);

        const schema = cloneDeep(graph.schema);
        schema.nodes = schema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...(node.config as SimpleAgentSchemaType),
                  instructions: `Sequential edit ${i}`,
                } satisfies SimpleAgentSchemaType,
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema,
          currentVersion: graph.version,
        });

        expect(updateResponse.revision).toBeDefined();
        revisionIds.push(updateResponse.revision!.id);

        await waitForRevisionStatus(
          graphId,
          updateResponse.revision!.id,
          GraphRevisionStatus.Applied,
        );
      }

      expect(revisionIds.length).toBe(3);
      const allRevisions = await revisionsService.getRevisions(graphId, {});
      expect(allRevisions.length).toBe(3);
      expect(
        allRevisions.every((r) => r.status === GraphRevisionStatus.Applied),
      ).toBe(true);

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('Sequential edit 3');
      expect(finalGraph.targetVersion).toBe(finalGraph.version);
    },
  );

  it(
    'handles non-conflicting structural changes',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                maxIterations: 100,
              },
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      expect(userAUpdate.revision).toBeDefined();

      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                enforceToolUsage: true,
              },
            }
          : node,
      );

      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      expect(userBUpdate.revision).toBeDefined();

      await waitForRevisionStatus(
        graphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );
      await waitForRevisionStatus(
        graphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      await wait(500);

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.maxIterations).toBe(100);
      expect(agentNode?.config.enforceToolUsage).toBe(true);
    },
  );

  it('applies revision immediately for non-running graph', async () => {
    const graphData = createMockGraphData();

    const createResponse = await graphsService.create(graphData);
    const graphId = createResponse.id;
    createdGraphIds.push(graphId);

    expect(createResponse.status).toBe(GraphStatus.Created);
    const currentVersion = createResponse.version;

    const updatedSchema = cloneDeep(createResponse.schema);
    updatedSchema.nodes = updatedSchema.nodes.map((node) =>
      node.id === TEST_AGENT_NODE_ID
        ? {
            ...node,
            config: {
              ...node.config,
              instructions: 'Non-running graph instructions',
            },
          }
        : node,
    );

    const updateResponse = await graphsService.update(graphId, {
      schema: updatedSchema,
      currentVersion,
    });

    expect(updateResponse.revision).toBeUndefined();

    const updatedGraph = await graphsService.findById(graphId);
    expect(updatedGraph.version).not.toBe(currentVersion);
    expect(updatedGraph.version).toBe(updatedGraph.targetVersion);

    const agentNode = updatedGraph.schema.nodes.find(
      (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
    );
    expect(agentNode?.config.instructions).toBe(
      'Non-running graph instructions',
    );
  });

  it(
    'handles graph deletion during revision processing',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const updatedSchema = cloneDeep(createResponse.schema);
      updatedSchema.nodes = updatedSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: 'Updated instructions',
              },
            }
          : node,
      );

      const updateResponse = await graphsService.update(graphId, {
        schema: updatedSchema,
        currentVersion: createResponse.version,
      });

      expect(updateResponse.revision).toBeDefined();
      const revisionId = updateResponse.revision!.id;

      await graphsService.destroy(graphId);
      await graphsService.delete(graphId);

      const index = createdGraphIds.indexOf(graphId);
      if (index > -1) {
        createdGraphIds.splice(index, 1);
      }

      await wait(3000);

      const revision = await revisionsService.getRevisionById(
        graphId,
        revisionId,
      );

      expect([
        GraphRevisionStatus.Applied,
        GraphRevisionStatus.Failed,
      ]).toContain(revision.status);

      if (revision.status === GraphRevisionStatus.Failed) {
        expect(revision.error).toBeDefined();
        const lower = revision.error!.toLowerCase();
        expect(lower).toContain('graph');
        expect(lower).toContain('not');
        expect(lower).toContain('found');
      }
    },
  );

  it(
    'queues revisions when graph is compiling',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();
      const newInstructions = 'Updated instructions during compilation';

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const currentVersion = createResponse.version;

      await graphsService.run(graphId);

      const updatedSchema = cloneDeep(createResponse.schema);
      updatedSchema.nodes = updatedSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: newInstructions,
              },
            }
          : node,
      );

      const updateResponse = await graphsService.update(graphId, {
        schema: updatedSchema,
        currentVersion,
      });

      expect(updateResponse.revision).toBeDefined();
      const revision = updateResponse.revision!;
      expect(revision.status).toBe(GraphRevisionStatus.Pending);

      await waitForGraphToBeRunning(graphId);
      await waitForRevisionStatus(
        graphId,
        revision.id,
        GraphRevisionStatus.Applied,
      );

      const appliedRevision = await revisionsService.getRevisionById(
        graphId,
        revision.id,
      );
      expect(appliedRevision.status).toBe(GraphRevisionStatus.Applied);

      const updatedGraph = await graphsService.findById(graphId);
      const agentNode = updatedGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(newInstructions);
    },
  );

  it(
    'handles non-running graphs gracefully when applying queued revisions',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();
      const newInstructions = 'Updated instructions for stopped graph';

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const currentVersion = createResponse.version;

      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const updatedSchema = cloneDeep(createResponse.schema);
      updatedSchema.nodes = updatedSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: newInstructions,
              },
            }
          : node,
      );

      const updateResponse = await graphsService.update(graphId, {
        schema: updatedSchema,
        currentVersion,
      });

      expect(updateResponse.revision).toBeDefined();
      const revisionId = updateResponse.revision!.id;

      await graphsService.destroy(graphId);

      await waitForRevisionStatus(
        graphId,
        revisionId,
        GraphRevisionStatus.Applied,
        30000,
      );

      const appliedRevision = await revisionsService.getRevisionById(
        graphId,
        revisionId,
      );
      expect(appliedRevision.status).toBe(GraphRevisionStatus.Applied);

      const updatedGraph = await graphsService.findById(graphId);
      expect(updatedGraph.status).toBe(GraphStatus.Stopped);
      expect(updatedGraph.version).toBe(appliedRevision.toVersion);

      const agentNode = updatedGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(newInstructions);
    },
  );

  describe('Edge Deletion and Validation', () => {
    it(
      'marks revision as failed when removing required edge (trigger needs agent)',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const updatedSchema = cloneDeep(createResponse.schema);
        updatedSchema.edges = [];

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Failed,
          30000,
        );

        const failedRevision = await revisionsService.getRevisionById(
          graphId,
          revisionId,
        );
        expect(failedRevision.status).toBe(GraphRevisionStatus.Failed);
        expect(failedRevision.error).toBeDefined();
        expect(failedRevision.error).toContain('No output connections found');
      },
    );

    it(
      'handles failed revision when removing required edge then applies valid revision',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const invalidSchema = cloneDeep(createResponse.schema);
        invalidSchema.edges = [];

        const firstUpdateResponse = await graphsService.update(graphId, {
          schema: invalidSchema,
          currentVersion,
        });

        expect(firstUpdateResponse.revision).toBeDefined();
        const firstRevisionId = firstUpdateResponse.revision!.id;

        const failedRevision = await waitForRevisionStatus(
          graphId,
          firstRevisionId,
          GraphRevisionStatus.Failed,
          30000,
        );
        expect(failedRevision.status).toBe(GraphRevisionStatus.Failed);
        expect(failedRevision.error).toContain('No output connections found');

        const graphAfterFailed = await graphsService.findById(graphId);
        expect(graphAfterFailed.version).toBe(currentVersion);
        expect(graphAfterFailed.schema.edges).toHaveLength(1);

        const graphBeforeValid = await graphsService.findById(graphId);
        const currentVersionForSecond = graphBeforeValid.version;

        const validSchema = cloneDeep(graphBeforeValid.schema);
        validSchema.nodes = validSchema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...node.config,
                  instructions: 'Updated after failed revision',
                },
              }
            : node,
        );

        const secondUpdateResponse = await graphsService.update(graphId, {
          schema: validSchema,
          currentVersion: currentVersionForSecond,
        });

        expect(secondUpdateResponse.revision).toBeDefined();
        const secondRevisionId = secondUpdateResponse.revision!.id;

        const appliedRevision = await waitForRevisionStatus(
          graphId,
          secondRevisionId,
          GraphRevisionStatus.Applied,
          30000,
        );
        expect(appliedRevision.status).toBe(GraphRevisionStatus.Applied);

        await wait(5000);

        const firstRevisionFinal = await revisionsService.getRevisionById(
          graphId,
          firstRevisionId,
        );
        expect(firstRevisionFinal.status).toBe(GraphRevisionStatus.Failed);

        const finalGraph = await graphsService.findById(graphId);

        expect(finalGraph.version).toBe(appliedRevision.toVersion);

        expect(finalGraph.schema.edges).toHaveLength(1);
        expect(finalGraph.schema.edges![0]).toEqual({
          from: 'trigger-1',
          to: 'agent-1',
        });

        const agentNode = finalGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
        );
        expect(agentNode?.config.instructions).toBe(
          'Updated after failed revision',
        );
      },
    );
  });

  describe('Configuration Changes with Execution Verification', () => {
    it(
      'applies revision when changing agent model and verifies execution',
      { timeout: 120000 },
      async () => {
        const graphData = createMockGraphData();

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const originalModel = (
          createResponse.schema.nodes.find(
            (node) => node.id === TEST_AGENT_NODE_ID,
          )?.config as SimpleAgentSchemaType
        ).invokeModelName;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const firstExecutionResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Say hello'],
            async: false,
          },
        );

        const firstThread = await waitForThreadCompletion(
          firstExecutionResult.threadId,
        );
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const updatedSchema = cloneDeep(createResponse.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...(node.config as SimpleAgentSchemaType),
                  invokeModelName: 'gpt-5',
                } satisfies SimpleAgentSchemaType,
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion: createResponse.version,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const updatedAgentNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
        );
        expect(
          (updatedAgentNode?.config as SimpleAgentSchemaType).invokeModelName,
        ).toBe('gpt-5');
        expect(
          (updatedAgentNode?.config as SimpleAgentSchemaType).invokeModelName,
        ).not.toBe(originalModel);

        const secondExecutionResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Say hello again'],
            async: false,
          },
        );

        const secondThread = await waitForThreadCompletion(
          secondExecutionResult.threadId,
        );
        expect(secondThread.status).toBe(ThreadStatus.Done);
        expect(secondThread.id).not.toBe(firstThread.id);
      },
    );

    it(
      'changes agent configuration and agent works with new config',
      { timeout: 120000 },
      async () => {
        const graphData = createMockGraphData();

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test message 1'],
            async: false,
          },
        );

        const firstThread = await waitForThreadCompletion(firstResult.threadId);
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const updatedSchema = cloneDeep(createResponse.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...(node.config as SimpleAgentSchemaType),
                  instructions:
                    'You are a new helpful agent. Always be polite.',
                  maxIterations: 10,
                } satisfies SimpleAgentSchemaType,
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion: createResponse.version,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const agentNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
        );
        expect(agentNode?.config.instructions).toBe(
          'You are a new helpful agent. Always be polite.',
        );
        expect((agentNode?.config as SimpleAgentSchemaType).maxIterations).toBe(
          10,
        );

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test message 2'],
            async: false,
          },
        );

        const secondThread = await waitForThreadCompletion(
          secondResult.threadId,
        );
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          secondThread.status,
        );
        expect(secondThread.id).not.toBe(firstThread.id);
      },
    );

    it(
      'applies runtime updates and graph continues to work',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Runtime Update Test ${Date.now()}`,
          description: 'Test runtime updates during live revision',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: COMMAND_AGENT_INSTRUCTIONS,
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  enforceToolUsage: false,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {
                    TEST_VAR: 'original_value',
                  },
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test1"'],
            async: false,
          },
        );

        const firstThread = await waitForThreadCompletion(firstResult.threadId);
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const firstMessages = await getThreadMessages(firstResult.threadId);
        const firstShell = findShellExecution(firstMessages);
        expect(firstShell.toolCallId).toBeDefined();
        expect(firstShell.toolName).toBe('shell');
        expect(firstShell.result).toBeDefined();
        expect(firstShell.result?.exitCode).toBe(0);
        expect(firstShell.result?.stdout).toContain('test1');

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === 'runtime-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  env: {
                    TEST_VAR: 'updated_value',
                  },
                },
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const runtimeNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'runtime-1',
        );
        expect(runtimeNode?.config.env).toEqual({
          TEST_VAR: 'updated_value',
        });

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test2"'],
            async: false,
          },
        );

        const secondThread = await waitForThreadCompletion(
          secondResult.threadId,
        );
        expect(secondThread.status).toBe(ThreadStatus.Done);
        expect(secondThread.id).not.toBe(firstThread.id);

        const secondMessages = await getThreadMessages(secondResult.threadId);
        const secondShell = findShellExecution(secondMessages);
        expect(secondShell.toolCallId).toBeDefined();
        expect(secondShell.toolName).toBe('shell');
        expect(secondShell.result).toBeDefined();
        expect(secondShell.result?.exitCode).toBe(0);
        expect(secondShell.result?.stdout).toContain('test2');
      },
    );

    it(
      'removes runtime node and graph continues to work without it',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Remove Runtime Test ${Date.now()}`,
          description: 'Test removing runtime during live revision',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: COMMAND_AGENT_INSTRUCTIONS,
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  enforceToolUsage: true,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {},
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test with runtime"'],
            async: false,
          },
        );

        const firstThread = await waitForThreadCompletion(firstResult.threadId);
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const firstMessages = await getThreadMessages(firstResult.threadId);
        const firstShell = findShellExecution(firstMessages);
        expect(firstShell.toolCallId).toBeDefined();
        expect(firstShell.toolName).toBe('shell');
        expect(firstShell.result).toBeDefined();
        expect(firstShell.result?.exitCode).toBe(0);
        expect(firstShell.result?.stdout).toContain('test with runtime');

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.filter(
          (n) => n.id !== 'runtime-1' && n.id !== 'shell-1',
        );
        updatedSchema.edges = updatedSchema.edges!.filter(
          (e) => e.to !== 'runtime-1' && e.to !== 'shell-1',
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const runtimeNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'runtime-1',
        );
        const shellNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'shell-1',
        );
        expect(runtimeNode).toBeUndefined();
        expect(shellNode).toBeUndefined();

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test without shell"'],
            async: false,
          },
        );

        const secondThread = await waitForThreadCompletion(
          secondResult.threadId,
        );
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          secondThread.status,
        );
        expect(secondThread.id).not.toBe(firstThread.id);

        const secondMessages = await getThreadMessages(secondResult.threadId);
        const secondShell = findShellExecution(secondMessages);
        expect(secondShell.toolCallId).toBeUndefined();
        expect(secondShell.toolName).toBeUndefined();
        expect(secondShell.result).toBeUndefined();
      },
    );

    it(
      'adds new tool to agent and graph works with it',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Add Tool Test ${Date.now()}`,
          description: 'Test adding tool to agent during live revision',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: COMMAND_AGENT_INSTRUCTIONS,
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  enforceToolUsage: true,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes.push({
          id: 'shell-1',
          template: 'shell-tool',
          config: {},
        });
        updatedSchema.nodes.push({
          id: 'runtime-1',
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: 'python:3.11-slim',
            env: {},
          },
        });
        updatedSchema.edges!.push({
          from: 'agent-1',
          to: 'shell-1',
        });
        updatedSchema.edges!.push({
          from: 'shell-1',
          to: 'runtime-1',
        });

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const shellNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'shell-1',
        );
        const runtimeNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'runtime-1',
        );
        expect(shellNode).toBeDefined();
        expect(runtimeNode).toBeDefined();

        const result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "hello from new tool"'],
            async: false,
          },
        );

        const thread = await waitForThreadCompletion(result.threadId);
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          thread.status,
        );

        const messages = await getThreadMessages(result.threadId);
        const shellExecution = findShellExecution(messages);
        expect(shellExecution.toolCallId).toBeDefined();
        expect(shellExecution.toolName).toBe('shell');
        expect(shellExecution.result).toBeDefined();
        expect(shellExecution.result?.exitCode).toBe(0);
        expect(shellExecution.result?.stdout).toContain('hello from new tool');
      },
    );

    it(
      'changes tool configuration and graph continues to work',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Tool Config Test ${Date.now()}`,
          description: 'Test tool configuration change during live revision',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: COMMAND_AGENT_INSTRUCTIONS,
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  enforceToolUsage: true,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {},
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === 'runtime-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  env: {
                    TEST_VAR: 'updated_value',
                  },
                },
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const toolNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'shell-1',
        );
        const runtimeNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'runtime-1',
        );
        expect(toolNode).toBeDefined();
        expect(runtimeNode?.config.env).toEqual({ TEST_VAR: 'updated_value' });

        const result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test tool config"'],
            async: false,
          },
        );

        const thread = await waitForThreadCompletion(result.threadId);
        expect(thread.status).toBe(ThreadStatus.Done);

        const messages = await getThreadMessages(result.threadId);
        const shellExecution = findShellExecution(messages);
        expect(shellExecution.toolCallId).toBeDefined();
        expect(shellExecution.toolName).toBe('shell');
        expect(shellExecution.result).toBeDefined();
        expect(shellExecution.result?.exitCode).toBe(0);
        expect(shellExecution.result?.stdout).toContain('test tool config');
      },
    );

    it(
      'changes resource configuration and graph continues to work',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Resource Config Test ${Date.now()}`,
          description:
            'Test runtime (resource) configuration change during live revision',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  instructions: COMMAND_AGENT_INSTRUCTIONS,
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  enforceToolUsage: true,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {
                    INITIAL_VAR: 'initial_value',
                  },
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === 'runtime-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  env: {
                    INITIAL_VAR: 'initial_value',
                    UPDATED_VAR: 'updated_value',
                  },
                },
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );

        const updatedGraph = await graphsService.findById(graphId);
        const runtimeNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'runtime-1',
        );
        expect(runtimeNode?.config.env).toEqual({
          INITIAL_VAR: 'initial_value',
          UPDATED_VAR: 'updated_value',
        });

        const result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test after resource change"'],
            async: false,
          },
        );

        const thread = await waitForThreadCompletion(result.threadId);
        expect(thread.status).toBe(ThreadStatus.Done);

        const messages = await getThreadMessages(result.threadId);
        const shellExecution = findShellExecution(messages);
        expect(shellExecution.toolCallId).toBeDefined();
        expect(shellExecution.toolName).toBe('shell');
        expect(shellExecution.result).toBeDefined();
        expect(shellExecution.result?.exitCode).toBe(0);
        expect(shellExecution.result?.stdout).toContain(
          'test after resource change',
        );
      },
    );
  });
});
