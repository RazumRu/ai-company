import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { cloneDeep } from 'lodash';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BaseMcp } from '../../../v1/agent-mcp/services/base-mcp';
import { ReasoningEffort } from '../../../v1/agents/agents.types';
import {
  SimpleAgent,
  SimpleAgentSchemaType,
} from '../../../v1/agents/services/agents/simple-agent';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import {
  GraphNodeSchemaType,
  GraphRevisionStatus,
  GraphStatus,
} from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphRevisionService } from '../../../v1/graphs/services/graph-revision.service';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { DockerRuntime } from '../../../v1/runtime/services/docker-runtime';
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
  let graphRegistry: GraphRegistry;
  const createdGraphIds: string[] = [];
  let coreGraphId: string;

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

  const getRuntime = (graphId: string, nodeId: string) => {
    const runtimeNode = graphRegistry.getNode<DockerRuntime>(graphId, nodeId);
    if (!runtimeNode) {
      throw new Error(`Runtime node ${nodeId} not found in graph ${graphId}`);
    }
    return runtimeNode.instance;
  };

  const getMcpOutput = (graphId: string, nodeId: string) => {
    const mcpNode = graphRegistry.getNode<BaseMcp>(graphId, nodeId);
    if (!mcpNode) {
      throw new Error(`MCP node ${nodeId} not found in graph ${graphId}`);
    }
    return mcpNode.instance;
  };

  const getContainerHostname = async (runtime: DockerRuntime) => {
    const res = await runtime.exec({ cmd: 'cat /etc/hostname' });
    if (res.fail) {
      throw new Error(
        `Failed to read hostname: exit=${res.exitCode} stderr=${res.stderr}`,
      );
    }
    return res.stdout.trim();
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
    options?: { cmdIncludes?: string; stdoutIncludes?: string },
  ): {
    toolName?: string;
    toolCallId?: string;
    result?: {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
  } => {
    // ThreadsService returns messages in DESC order (newest first). We want the latest shell
    // execution, so we must search in the returned order (do NOT reverse).
    if (options?.stdoutIncludes) {
      const stdoutIncludes = options.stdoutIncludes;
      const shellEntry = messages.find(
        (
          entry,
        ): entry is ThreadMessageDto & {
          message: ShellThreadMessage;
        } => {
          if (!isShellThreadMessage(entry.message)) return false;
          const content =
            entry.message.role === 'tool-shell'
              ? entry.message.content
              : entry.message.content;
          const stdout = (content as { stdout?: unknown } | undefined)?.stdout;
          return typeof stdout === 'string' && stdout.includes(stdoutIncludes);
        },
      );

      const result =
        shellEntry?.message.role === 'tool-shell'
          ? shellEntry.message.content
          : shellEntry?.message.role === 'tool'
            ? (shellEntry.message.content as {
                exitCode?: number;
                stdout?: string;
                stderr?: string;
              })
            : undefined;

      return {
        toolName: shellEntry?.message.name,
        toolCallId: shellEntry?.message.toolCallId,
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
    }

    const aiEntries = messages.filter(
      (
        entry,
      ): entry is ThreadMessageDto & {
        message: Extract<ThreadMessageDto['message'], { role: 'ai' }>;
      } =>
        isAiThreadMessage(entry.message) &&
        Boolean(entry.message.toolCalls?.some((tc) => tc.name === 'shell')),
    );

    const selectShellCall = () => {
      for (const aiEntry of aiEntries) {
        for (const tc of aiEntry.message.toolCalls ?? []) {
          if (tc.name !== 'shell') continue;
          const cmd = (tc.args as { cmd?: unknown } | undefined)?.cmd;
          if (options?.cmdIncludes) {
            if (typeof cmd !== 'string' || !cmd.includes(options.cmdIncludes)) {
              continue;
            }
          }

          const shellEntry = messages.find(
            (
              entry,
            ): entry is ThreadMessageDto & {
              message: ShellThreadMessage;
            } =>
              isShellThreadMessage(entry.message) &&
              entry.message.toolCallId === tc.id,
          );

          return {
            aiMessage: aiEntry.message,
            shellMessage: shellEntry?.message,
          };
        }
      }
      return { aiMessage: undefined, shellMessage: undefined };
    };

    const { aiMessage, shellMessage } = selectShellCall();

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
    graphRegistry = app.get<GraphRegistry>(GraphRegistry);
    // Shared graph for revision/merge/conflict semantics. These tests do not require
    // a clean 1.0.0 baseline; they validate relative behavior using the current version.
    const coreGraph = await graphsService.create(
      createMockGraphData({
        name: `Graph Revisions Core ${Date.now()}`,
      }),
    );
    coreGraphId = coreGraph.id;
    createdGraphIds.push(coreGraphId);

    await graphsService.run(coreGraphId);
    await waitForGraphToBeRunning(coreGraphId, 120000);
  }, 180000);

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
  }, 180000);

  const ensureCoreGraphRunning = async () => {
    const graph = await graphsService.findById(coreGraphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(coreGraphId);
    await waitForGraphToBeRunning(coreGraphId, 120000);
  };

  it('applies a revision to a running graph', { timeout: 60000 }, async () => {
    const newInstructions = 'Updated instructions for live revision';

    await ensureCoreGraphRunning();
    const baseGraph = await graphsService.findById(coreGraphId);
    const baseVersion = baseGraph.version;

    const updatedSchema = cloneDeep(baseGraph.schema);
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
    const updateResponse = await graphsService.update(coreGraphId, {
      schema: updatedSchema,
      currentVersion: baseVersion,
    });

    expect(updateResponse.revision).toBeDefined();
    expect(updateResponse.revision!.status).toBe(GraphRevisionStatus.Pending);
    expect(updateResponse.revision!.toVersion).not.toBe(baseVersion);
    const revisionId = updateResponse.revision!.id;

    const revision = await waitForRevisionStatus(
      coreGraphId,
      revisionId,
      GraphRevisionStatus.Applied,
    );

    expect(revision.status).toBe(GraphRevisionStatus.Applied);
    expect(revision.error).toBeUndefined();

    const updatedGraph = await graphsService.findById(coreGraphId);
    expect(updatedGraph.version).toBe(revision.toVersion);
    expect(updatedGraph.targetVersion).toBe(revision.toVersion);

    const agentNode = updatedGraph.schema.nodes.find(
      (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
    );
    expect(agentNode?.config.instructions).toBe(newInstructions);
  });

  it(
    'processes queued revisions sequentially',
    { timeout: 60000 },
    async () => {
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);
      const baseVersion = baseGraph.version;

      const firstSchema = cloneDeep(baseGraph.schema);
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

      const firstUpdateResponse = await graphsService.update(coreGraphId, {
        schema: firstSchema,
        currentVersion: baseVersion,
      });

      expect(firstUpdateResponse.revision).toBeDefined();
      const firstRevision = firstUpdateResponse.revision!;
      expect(firstRevision.toVersion).not.toBe(baseVersion);

      await waitForRevisionStatus(
        coreGraphId,
        firstRevision.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterFirst = await graphsService.findById(coreGraphId);
      expect(graphAfterFirst.version).toBe(firstRevision.toVersion);

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

      const secondUpdateResponse = await graphsService.update(coreGraphId, {
        schema: secondSchema,
        currentVersion: graphAfterFirst.version,
      });

      expect(secondUpdateResponse.revision).toBeDefined();
      const secondRevision = secondUpdateResponse.revision!;
      expect(secondRevision.toVersion).not.toBe(graphAfterFirst.version);

      await waitForRevisionStatus(
        coreGraphId,
        secondRevision.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(coreGraphId);
      expect(finalGraph.version).toBe(secondRevision.toVersion);
      expect(finalGraph.targetVersion).toBe(secondRevision.toVersion);

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
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);
      const baseVersion = baseGraph.version;
      const baseSchema = baseGraph.schema;

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

      const userAUpdate = await graphsService.update(coreGraphId, {
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
                invokeModelName: 'gpt-5.1',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userBUpdate = await graphsService.update(coreGraphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      const userBRevisionId = userBUpdate.revision?.id;

      const revisionIds = [userARevisionId, userBRevisionId].filter(
        (id): id is string => typeof id === 'string',
      );

      for (const revisionId of revisionIds) {
        await waitForRevisionStatus(
          coreGraphId,
          revisionId,
          GraphRevisionStatus.Applied,
        );
      }

      if (revisionIds.length < 2) {
        // Revisions may be compacted by the server; ensure at least 2 applied revisions exist.
        await waitForAppliedRevisions(coreGraphId, 2);
      }

      await waitForCondition(
        () => graphsService.findById(coreGraphId),
        (graph) =>
          graph.version !== baseVersion &&
          graph.targetVersion === graph.version,
        { timeout: 60000, interval: 1000 },
      );

      await wait(500);

      const finalGraph = await graphsService.findById(coreGraphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('User A instructions');
      expect((agentNode?.config as SimpleAgentSchemaType).invokeModelName).toBe(
        'gpt-5.1',
      );
    },
  );

  it(
    'rejects stale edits and allows refresh-retry flow',
    { timeout: 60000 },
    async () => {
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);
      const baseVersion = baseGraph.version;
      const baseSchema = baseGraph.schema;

      const userAInstructions = `User A instructions ${Date.now()}`;
      const userBInstructions = `User B conflicting instructions ${Date.now()}`;

      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: userAInstructions,
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userAUpdate = await graphsService.update(coreGraphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      expect(userAUpdate.revision).toBeDefined();
      await waitForRevisionStatus(
        coreGraphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUserA = await graphsService.findById(coreGraphId);
      const currentVersion = graphAfterUserA.version;

      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: userBInstructions,
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      await expect(
        graphsService.update(coreGraphId, {
          schema: userBSchema,
          currentVersion: baseVersion,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'VERSION_CONFLICT',
      });

      const userBUpdate = await graphsService.update(coreGraphId, {
        schema: userBSchema,
        currentVersion: currentVersion,
      });

      expect(userBUpdate.revision).toBeDefined();

      await waitForRevisionStatus(
        coreGraphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(coreGraphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(userBInstructions);
    },
  );

  it(
    'handles three users with cascading changes',
    { timeout: 60000 },
    async () => {
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);

      let currentVersion = baseGraph.version;
      const baseSchema = baseGraph.schema;

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

      const user1Update = await graphsService.update(coreGraphId, {
        schema: user1Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        coreGraphId,
        user1Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUser1 = await graphsService.findById(coreGraphId);
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

      const user2Update = await graphsService.update(coreGraphId, {
        schema: user2Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        coreGraphId,
        user2Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const graphAfterUser2 = await graphsService.findById(coreGraphId);
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

      const user3Update = await graphsService.update(coreGraphId, {
        schema: user3Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        coreGraphId,
        user3Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(coreGraphId);
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
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);
      const baseVersion = baseGraph.version;
      const baseSchema = baseGraph.schema;

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

      const firstResponse = await graphsService.update(coreGraphId, {
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
        graphsService.update(coreGraphId, {
          schema: schema2,
          currentVersion: baseVersion,
        }),
      ).rejects.toMatchObject({
        errorCode: 'MERGE_CONFLICT',
        statusCode: 400,
      });

      await waitForRevisionStatus(
        coreGraphId,
        firstResponse.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(coreGraphId);
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
      await ensureCoreGraphRunning();
      const beforeRevisions = await revisionsService.getRevisions(coreGraphId, {
        limit: 1000,
      });
      const beforeCount = beforeRevisions.length;

      const revisionIds: string[] = [];

      for (let i = 1; i <= 3; i++) {
        const graph = await graphsService.findById(coreGraphId);

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

        const updateResponse = await graphsService.update(coreGraphId, {
          schema,
          currentVersion: graph.version,
        });

        expect(updateResponse.revision).toBeDefined();
        revisionIds.push(updateResponse.revision!.id);

        await waitForRevisionStatus(
          coreGraphId,
          updateResponse.revision!.id,
          GraphRevisionStatus.Applied,
        );
      }

      expect(revisionIds.length).toBe(3);
      const afterRevisions = await revisionsService.getRevisions(coreGraphId, {
        limit: 1000,
      });
      expect(afterRevisions.length).toBeGreaterThanOrEqual(beforeCount + 3);

      const finalGraph = await graphsService.findById(coreGraphId);
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
      await ensureCoreGraphRunning();
      const baseGraph = await graphsService.findById(coreGraphId);
      const baseVersion = baseGraph.version;
      const baseSchema = baseGraph.schema;

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

      const userAUpdate = await graphsService.update(coreGraphId, {
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

      const userBUpdate = await graphsService.update(coreGraphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      expect(userBUpdate.revision).toBeDefined();

      await waitForRevisionStatus(
        coreGraphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );
      await waitForRevisionStatus(
        coreGraphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      await wait(500);

      const finalGraph = await graphsService.findById(coreGraphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.maxIterations).toBe(100);
      expect(agentNode?.config.enforceToolUsage).toBe(true);
    },
  );

  it(
    'creates and applies revision for non-running graph',
    { timeout: 60000 },
    async () => {
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

      // Should now create a revision even for non-running graphs
      expect(updateResponse.revision).toBeDefined();
      const revisionId = updateResponse.revision!.id;

      // Wait for revision to be applied
      await waitForRevisionStatus(
        graphId,
        revisionId,
        GraphRevisionStatus.Applied,
        30000,
      );

      const updatedGraph = await graphsService.findById(graphId);
      expect(updatedGraph.version).not.toBe(currentVersion);
      expect(updatedGraph.version).toBe(updatedGraph.targetVersion);

      const agentNode = updatedGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(
        'Non-running graph instructions',
      );
    },
  );

  it(
    'creates and applies revision for name-only update (non-running graph)',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      expect(createResponse.status).toBe(GraphStatus.Created);
      const currentVersion = createResponse.version;

      const newName = `Renamed graph ${Date.now()}`;

      const updateResponse = await graphsService.update(graphId, {
        name: newName,
        currentVersion,
      });

      expect(updateResponse.revision).toBeDefined();
      const revisionId = updateResponse.revision!.id;

      await waitForRevisionStatus(
        graphId,
        revisionId,
        GraphRevisionStatus.Applied,
        30000,
      );

      const updatedGraph = await graphsService.findById(graphId);
      expect(updatedGraph.name).toBe(newName);
      expect(updatedGraph.version).not.toBe(currentVersion);
      expect(updatedGraph.version).toBe(updatedGraph.targetVersion);
    },
  );

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
      { timeout: 180_000 },
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

        await expect(
          graphsService.update(graphId, {
            schema: updatedSchema,
            currentVersion,
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'MISSING_REQUIRED_CONNECTION',
        });
      },
    );

    it(
      'handles failed revision when removing required edge then applies valid revision',
      { timeout: 180_000 },
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

        const graphBeforeUpdate = await graphsService.findById(graphId);
        expect(graphBeforeUpdate.status).toBe(GraphStatus.Running);

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

        // First update: invalid schema should be rejected before a revision is created.
        await expect(
          graphsService.update(graphId, {
            schema: invalidSchema,
            currentVersion,
          }),
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'MISSING_REQUIRED_CONNECTION',
        });

        // Second update: valid schema should still apply as a live revision.
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
          60_000,
        );
        expect(appliedRevision.status).toBe(GraphRevisionStatus.Applied);

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
          firstExecutionResult.externalThreadId,
        );
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const updatedSchema = cloneDeep(createResponse.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...(node.config as SimpleAgentSchemaType),
                  invokeModelName: 'gpt-5.1',
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
        ).toBe('gpt-5.1');
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
          secondExecutionResult.externalThreadId,
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

        const firstThread = await waitForThreadCompletion(
          firstResult.externalThreadId,
        );
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
          secondResult.externalThreadId,
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
                  name: 'Test Agent',
                  description: 'Test agent description',
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  invokeModelReasoningEffort: ReasoningEffort.None,
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

        const firstThread = await waitForThreadCompletion(
          firstResult.externalThreadId,
        );
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const firstMessages = await getThreadMessages(
          firstResult.externalThreadId,
        );
        const firstShell = findShellExecution(firstMessages, {
          stdoutIncludes: 'test1',
        });
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
          secondResult.externalThreadId,
        );
        expect(secondThread.status).toBe(ThreadStatus.Done);
        expect(secondThread.id).not.toBe(firstThread.id);

        const secondMessages = await getThreadMessages(
          secondResult.externalThreadId,
        );
        const secondShell = findShellExecution(secondMessages, {
          stdoutIncludes: 'test2',
        });
        expect(secondShell.toolCallId).toBeDefined();
        expect(secondShell.toolName).toBe('shell');
        expect(secondShell.result).toBeDefined();
        expect(secondShell.result?.exitCode).toBe(0);
        expect(secondShell.result?.stdout).toContain('test2');
      },
    );

    it(
      'keeps shell tool usable after runtime update revision (runtime reload) in the same thread',
      { timeout: 180000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `Shell runtime reload test ${Date.now()}`,
          description:
            'Shell tool should still execute commands after runtime reload revision',
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
                  name: 'Test Agent',
                  description: 'Test agent description',
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  invokeModelReasoningEffort: ReasoningEffort.None,
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
                  image: 'node:20',
                  env: {
                    TEST_VAR: 'original',
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

        const runtimeBefore = getRuntime(graphId, 'runtime-1');
        const hostnameBefore = await getContainerHostname(runtimeBefore);

        const threadSubId = `shell-reload-${Date.now()}`;
        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "before-reload"'],
            async: false,
            threadSubId,
          },
        );

        const firstThread = await waitForThreadCompletion(
          firstResult.externalThreadId,
        );
        expect(firstThread.status).toBe(ThreadStatus.Done);
        const firstInternalThread = await threadsService.getThreadByExternalId(
          firstResult.externalThreadId,
        );

        const firstMessages = await getThreadMessages(
          firstResult.externalThreadId,
        );
        const firstShell = findShellExecution(firstMessages, {
          stdoutIncludes: 'before-reload',
        });
        expect(firstShell.toolCallId).toBeDefined();
        expect(firstShell.toolName).toBe('shell');
        expect(firstShell.result?.exitCode).toBe(0);
        expect(firstShell.result?.stdout).toContain('before-reload');

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === 'runtime-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  // Force container recreate (image + env changes)
                  image: 'node:20-slim',
                  env: { TEST_VAR: 'updated' },
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
          120000,
        );
        await waitForGraphToBeRunning(graphId, 120000);

        const runtimeAfter = getRuntime(graphId, 'runtime-1');
        const hostnameAfter = await getContainerHostname(runtimeAfter);
        expect(hostnameAfter).not.toBe(hostnameBefore);

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "after-reload"'],
            async: false,
            threadSubId,
          },
        );

        const secondThread = await waitForThreadCompletion(
          secondResult.externalThreadId,
        );
        expect(secondThread.status).toBe(ThreadStatus.Done);

        const secondInternalThread = await threadsService.getThreadByExternalId(
          secondResult.externalThreadId,
        );
        expect(secondInternalThread.id).toBe(firstInternalThread.id);

        const secondMessages = await getThreadMessages(
          secondResult.externalThreadId,
        );
        const secondShell = findShellExecution(secondMessages, {
          stdoutIncludes: 'after-reload',
        });
        expect(secondShell.toolCallId).toBeDefined();
        expect(secondShell.toolName).toBe('shell');
        expect(secondShell.result?.exitCode).toBe(0);
        expect(secondShell.result?.stdout).toContain('after-reload');
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

        const firstThread = await waitForThreadCompletion(
          firstResult.externalThreadId,
        );
        expect(firstThread.status).toBe(ThreadStatus.Done);

        const firstMessages = await getThreadMessages(
          firstResult.externalThreadId,
        );
        const firstShell = findShellExecution(firstMessages);
        expect(firstShell.toolCallId).toBeDefined();
        expect(firstShell.toolName).toBe('shell');
        expect(firstShell.result).toBeDefined();
        expect(firstShell.result?.exitCode).toBe(0);
        expect(firstShell.result?.stdout).toContain('test with runtime');

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes
          .filter((n) => n.id !== 'runtime-1' && n.id !== 'shell-1')
          .map((node) =>
            node.id === 'agent-1'
              ? {
                  ...node,
                  config: {
                    ...(node.config as SimpleAgentSchemaType),
                    instructions:
                      'You are a helpful assistant. Answer questions directly without using any tools.',
                    enforceToolUsage: false,
                  } satisfies SimpleAgentSchemaType,
                }
              : node,
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

        await wait(5000);

        const executeWithoutShell = async () => {
          const result = await graphsService.executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "test without shell"'],
              async: false,
            },
          );

          const thread = await waitForThreadCompletion(result.externalThreadId);
          const messages = await getThreadMessages(result.externalThreadId);

          return {
            thread,
            shellExecution: findShellExecution(messages),
          };
        };

        const { thread: secondThread, shellExecution: secondShell } =
          await waitForCondition(
            executeWithoutShell,
            ({ shellExecution }) =>
              !shellExecution.toolCallId &&
              !shellExecution.toolName &&
              !shellExecution.result,
            { timeout: 60000, interval: 5000 },
          );

        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          secondThread.status,
        );
        expect(secondThread.id).not.toBe(firstThread.id);
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

        await wait(5000);

        const executeWithNewTool = async () => {
          const result = await graphsService.executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "hello from new tool"'],
              async: false,
            },
          );

          const thread = await waitForThreadCompletion(result.externalThreadId);
          const messages = await getThreadMessages(result.externalThreadId);

          return {
            thread,
            shellExecution: findShellExecution(messages),
          };
        };

        const { thread, shellExecution } = await waitForCondition(
          executeWithNewTool,
          ({ shellExecution }) =>
            Boolean(shellExecution.toolCallId) &&
            shellExecution.toolName === 'shell' &&
            Boolean(shellExecution.result),
          { timeout: 90000, interval: 5000 },
        );

        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          thread.status,
        );
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

        const thread = await waitForThreadCompletion(result.externalThreadId);
        expect(thread.status).toBe(ThreadStatus.Done);

        const messages = await getThreadMessages(result.externalThreadId);
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

        const thread = await waitForThreadCompletion(result.externalThreadId);
        expect(thread.status).toBe(ThreadStatus.Done);

        const messages = await getThreadMessages(result.externalThreadId);
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

  describe('MCP + Graph Revisions', () => {
    it(
      'keeps filesystem MCP usable after runtime update revision (runtime reload)',
      { timeout: 180000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `MCP runtime update test ${Date.now()}`,
          description:
            'Filesystem MCP should keep working after runtime reload',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'node:20',
                  env: {
                    TEST_VAR: 'original',
                  },
                },
              },
              {
                id: 'mcp-fs-1',
                template: 'filesystem-mcp',
                config: {},
              },
            ],
            edges: [{ from: 'mcp-fs-1', to: 'runtime-1' }],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const runtimeBefore = getRuntime(graphId, 'runtime-1');
        const hostnameBefore = await getContainerHostname(runtimeBefore);

        const mcpBefore = getMcpOutput(graphId, 'mcp-fs-1');
        const toolsBefore = await mcpBefore.discoverTools();
        const listDirToolBefore = toolsBefore.find(
          (t: { name: string }) => t.name === 'list_directory',
        );
        expect(listDirToolBefore).toBeDefined();
        const beforeResult = await listDirToolBefore!.invoke({
          path: '/runtime-workspace',
        });
        expect(beforeResult).toBeDefined();
        expect(beforeResult.output).toBeDefined();

        const updatedSchema = cloneDeep(graphData.schema);
        updatedSchema.nodes = updatedSchema.nodes.map((node) =>
          node.id === 'runtime-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  // Force container recreate (image + env changes)
                  image: 'node:20-slim',
                  env: { TEST_VAR: 'updated' },
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
          120000,
        );

        await waitForGraphToBeRunning(graphId);

        const runtimeAfter = getRuntime(graphId, 'runtime-1');
        const hostnameAfter = await getContainerHostname(runtimeAfter);
        expect(hostnameAfter).not.toBe(hostnameBefore);

        const mcpAfter = getMcpOutput(graphId, 'mcp-fs-1');
        const toolsAfter = await mcpAfter.discoverTools();
        const listDirToolAfter = toolsAfter.find(
          (t: { name: string }) => t.name === 'list_directory',
        );
        expect(listDirToolAfter).toBeDefined();
        const afterResult = await listDirToolAfter!.invoke({
          path: '/runtime-workspace',
        });
        expect(afterResult).toBeDefined();
        expect(afterResult.output).toBeDefined();
      },
    );

    it(
      'keeps filesystem MCP usable after revision (triggered by config update)',
      { timeout: 180000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `MCP config update test ${Date.now()}`,
          description:
            'Filesystem MCP should be usable after a revision is applied',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'node:20',
                  env: {},
                },
              },
              {
                id: 'mcp-fs-1',
                template: 'filesystem-mcp',
                config: {},
              },
            ],
            edges: [{ from: 'mcp-fs-1', to: 'runtime-1' }],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const mcpBefore = getMcpOutput(graphId, 'mcp-fs-1');
        const toolsBefore = await mcpBefore.discoverTools();
        const listDirToolBefore = toolsBefore.find(
          (t: { name: string }) => t.name === 'list_directory',
        );
        expect(listDirToolBefore).toBeDefined();
        const beforeResult = await listDirToolBefore!.invoke({
          path: '/runtime-workspace',
        });
        expect(beforeResult).toBeDefined();
        expect(beforeResult.output).toBeDefined();

        // Update runtime config to force a revision
        const graph = await graphsService.findById(graphId);
        const updatedSchema = cloneDeep(graph.schema);
        const runtimeNode = updatedSchema.nodes.find(
          (n) => n.id === 'runtime-1',
        );
        if (runtimeNode) {
          runtimeNode.config = {
            ...runtimeNode.config,
            env: { FORCED_UPDATE: 'true' },
          };
        }

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
          120000,
        );

        await waitForGraphToBeRunning(graphId);

        const mcpAfter = getMcpOutput(graphId, 'mcp-fs-1');
        const toolsAfter = await mcpAfter.discoverTools();
        const listDirToolAfter = toolsAfter.find(
          (t: { name: string }) => t.name === 'list_directory',
        );
        expect(listDirToolAfter).toBeDefined();
        const afterResult = await listDirToolAfter!.invoke({
          path: '/runtime-workspace',
        });
        expect(afterResult).toBeDefined();
        expect(afterResult.output).toBeDefined();
      },
    );

    it(
      'changes MCP readOnly mode and agent gets updated tools list',
      { timeout: 180000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `MCP readOnly mode test ${Date.now()}`,
          description:
            'Agent should get updated tools when MCP readOnly mode changes',
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
                  instructions:
                    'You are a filesystem assistant. List files and directories when asked.',
                  name: 'Filesystem Agent',
                  description: 'Agent with filesystem tools',
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  invokeModelReasoningEffort: ReasoningEffort.None,
                  enforceToolUsage: false,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'node:20',
                  env: {},
                },
              },
              {
                id: 'mcp-fs-1',
                template: 'filesystem-mcp',
                config: {
                  readOnly: false,
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'mcp-fs-1' },
              { from: 'mcp-fs-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        // Verify agent has write tools initially (readOnly = false)
        const agentBefore = graphRegistry.getNodeInstance<SimpleAgent>(
          graphId,
          'agent-1',
        );
        const toolsBefore = agentBefore?.getTools() ?? [];
        const writeToolBefore = toolsBefore.find(
          (t) => t.name === 'write_file',
        );
        const readToolBefore = toolsBefore.find(
          (t) => t.name === 'read_text_file',
        );
        expect(writeToolBefore).toBeDefined();
        expect(readToolBefore).toBeDefined();

        // Change readOnly mode to true
        const graph = await graphsService.findById(graphId);
        const updatedSchema = cloneDeep(graph.schema);
        const mcpNode = updatedSchema.nodes.find((n) => n.id === 'mcp-fs-1');
        if (mcpNode) {
          mcpNode.config = {
            ...mcpNode.config,
            readOnly: true,
          };
        }

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
          120000,
        );

        await waitForGraphToBeRunning(graphId);

        // Wait a bit for the reconfiguration to complete
        await wait(5000);

        // Verify the updated graph schema
        const updatedGraph = await graphsService.findById(graphId);
        const updatedMcpNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'mcp-fs-1',
        );
        expect(updatedMcpNode?.config.readOnly).toBe(true);

        // Verify agent's toolset is updated (write tools removed)
        const agentAfter = graphRegistry.getNodeInstance<SimpleAgent>(
          graphId,
          'agent-1',
        );
        const toolsAfter = agentAfter?.getTools() ?? [];
        const writeToolAfter = toolsAfter.find((t) => t.name === 'write_file');
        const readToolAfter = toolsAfter.find(
          (t) => t.name === 'read_text_file',
        );
        const listDirToolAfter = toolsAfter.find(
          (t) => t.name === 'list_directory',
        );

        expect(writeToolAfter).toBeUndefined();
        expect(readToolAfter).toBeDefined();
        expect(listDirToolAfter).toBeDefined();

        // Execute a trigger to verify the agent works with updated tools
        const result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['List files in /runtime-workspace'],
            async: false,
          },
        );

        const thread = await waitForThreadCompletion(result.externalThreadId);
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          thread.status,
        );
      },
    );

    it(
      'applies revision immediately for non-running graph with MCP config change',
      { timeout: 120000 },
      async () => {
        const graphData: CreateGraphDto = {
          name: `MCP non-running graph test ${Date.now()}`,
          description:
            'MCP readOnly change should create revision even for non-running graph',
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
                  instructions: 'You are a helpful assistant.',
                  name: 'Test Agent',
                  description: 'Test agent description',
                  summarizeMaxTokens: 272000,
                  summarizeKeepTokens: 30000,
                  invokeModelName: 'gpt-5-mini',
                  invokeModelReasoningEffort: ReasoningEffort.None,
                  enforceToolUsage: false,
                  maxIterations: 50,
                } satisfies SimpleAgentSchemaType,
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'node:20',
                  env: {},
                },
              },
              {
                id: 'mcp-fs-1',
                template: 'filesystem-mcp',
                config: {
                  readOnly: false,
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'mcp-fs-1' },
              { from: 'mcp-fs-1', to: 'runtime-1' },
            ],
          },
        };

        const createResponse = await graphsService.create(graphData);
        const graphId = createResponse.id;
        createdGraphIds.push(graphId);
        const currentVersion = createResponse.version;

        expect(createResponse.status).toBe(GraphStatus.Created);

        // Change readOnly mode without running the graph
        const updatedSchema = cloneDeep(graphData.schema);
        const mcpNode = updatedSchema.nodes.find((n) => n.id === 'mcp-fs-1');
        if (mcpNode) {
          mcpNode.config = {
            ...mcpNode.config,
            readOnly: true,
          };
        }

        const updateResponse = await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        // Should create a revision even for non-running graph
        expect(updateResponse.revision).toBeDefined();
        const revisionId = updateResponse.revision!.id;

        // Wait for revision to be applied
        await waitForRevisionStatus(
          graphId,
          revisionId,
          GraphRevisionStatus.Applied,
          60000,
        );

        // Verify the schema was updated
        const updatedGraph = await graphsService.findById(graphId);
        expect(updatedGraph.version).not.toBe(currentVersion);
        expect(updatedGraph.version).toBe(updatedGraph.targetVersion);

        const updatedMcpNode = updatedGraph.schema.nodes.find(
          (node: GraphNodeSchemaType) => node.id === 'mcp-fs-1',
        );
        expect(updatedMcpNode?.config.readOnly).toBe(true);

        // Now run the graph and verify it works with the updated config
        await graphsService.run(graphId);
        await waitForGraphToBeRunning(graphId);

        const mcp = getMcpOutput(graphId, 'mcp-fs-1');
        const tools = await mcp.discoverTools();
        const writeTool = tools.find(
          (t: { name: string }) => t.name === 'write_file',
        );
        const readTool = tools.find(
          (t: { name: string }) => t.name === 'read_text_file',
        );

        expect(writeTool).toBeUndefined();
        expect(readTool).toBeDefined();
      },
    );
  });
});
