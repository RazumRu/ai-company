import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const TRIGGER_NODE_ID = 'trigger-1';
const AGENT_NODE_ID = 'agent-1';
const SHELL_NODE_ID = 'shell-1';
const RUNTIME_NODE_ID = 'runtime-1';
const GITHUB_RESOURCE_NODE_ID = 'github-resource-1';

const COMMAND_AGENT_INSTRUCTIONS =
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, call the finish tool with the stdout (and stderr if present). If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

const THREAD_COMPLETION_STATUSES: ThreadStatus[] = [
  ThreadStatus.Done,
  ThreadStatus.NeedMoreInfo,
];

describe('Graph Resources Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

  const registerGraph = (graphId: string) => {
    if (!createdGraphIds.includes(graphId)) {
      createdGraphIds.push(graphId);
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
    timeoutMs = 180_000,
  ) => {
    return waitForCondition(
      () => graphsService.findById(graphId),
      (graph) => graph.status === status,
      { timeout: timeoutMs, interval: 1_000 },
    );
  };

  const waitForThreadCompletion = async (externalThreadId: string) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);

    return waitForCondition(
      () => threadsService.getThreadById(thread.id),
      (currentThread) =>
        THREAD_COMPLETION_STATUSES.includes(currentThread.status),
      { timeout: 120_000, interval: 1_000 },
    );
  };

  const getThreadMessages = async (externalThreadId: string) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);
    return threadsService.getThreadMessages(thread.id);
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

  const findShellExecution = (messages: ThreadMessageDto[]) => {
    const aiMessage = messages
      .map((message) => message.message)
      .find(isAiThreadMessage);

    const shellMessage = messages
      .map((message) => message.message)
      .find(isShellThreadMessage);

    const shellToolCall = aiMessage?.toolCalls?.find(
      (toolCall) => toolCall.name === 'shell',
    );

    const rawResult =
      shellMessage?.role === 'tool-shell'
        ? shellMessage.content
        : shellMessage?.role === 'tool'
          ? (shellMessage.content as {
              exitCode?: number;
              stdout?: string;
              stderr?: string;
            })
          : undefined;

    const result =
      rawResult &&
      typeof rawResult.exitCode === 'number' &&
      typeof rawResult.stdout === 'string' &&
      typeof rawResult.stderr === 'string'
        ? {
            exitCode: rawResult.exitCode,
            stdout: rawResult.stdout,
            stderr: rawResult.stderr,
          }
        : undefined;

    return {
      toolName: shellToolCall?.name ?? shellMessage?.name,
      toolCallId: shellToolCall?.id ?? shellMessage?.toolCallId,
      result,
    };
  };

  const createResourceGraphData = (options?: {
    includeResource?: boolean;
    resourceEdgeTarget?: string;
  }): CreateGraphDto => {
    const includeResource = options?.includeResource ?? true;
    const resourceEdgeTarget =
      options?.resourceEdgeTarget ??
      (includeResource ? GITHUB_RESOURCE_NODE_ID : 'missing-resource-node');

    const nodes: CreateGraphDto['schema']['nodes'] = [
      {
        id: TRIGGER_NODE_ID,
        template: 'manual-trigger',
        config: {},
      },
      {
        id: AGENT_NODE_ID,
        template: 'simple-agent',
        config: {
          instructions: COMMAND_AGENT_INSTRUCTIONS,
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
    ];

    if (includeResource) {
      nodes.push({
        id: GITHUB_RESOURCE_NODE_ID,
        template: 'github-resource',
        config: {
          patToken: 'mock-token-for-testing',
          auth: false,
        },
      });
    }

    return {
      name: `Resource Graph ${Date.now()}`,
      description: 'Integration test graph for resource nodes',
      temporary: true,
      schema: {
        nodes,
        edges: [
          { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
          { from: AGENT_NODE_ID, to: SHELL_NODE_ID },
          { from: SHELL_NODE_ID, to: RUNTIME_NODE_ID },
          { from: SHELL_NODE_ID, to: resourceEdgeTarget },
        ],
      },
    };
  };

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
  });

  afterEach(async () => {
    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (graphId) {
        await cleanupGraph(graphId);
      }
    }
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe('GitHub resource execution', () => {
    it(
      'executes GitHub CLI commands through the shell tool when the resource is connected',
      { timeout: 240_000 },
      async () => {
        const graphData = createResourceGraphData();
        const graph = await graphsService.create(graphData);
        registerGraph(graph.id);

        await graphsService.run(graph.id);
        await waitForGraphStatus(graph.id, GraphStatus.Running);

        const execution = await graphsService.executeTrigger(
          graph.id,
          TRIGGER_NODE_ID,
          {
            messages: ['Run this command: gh version'],
            async: false,
          },
        );

        expect(execution.externalThreadId).toBeDefined();

        const thread = await waitForThreadCompletion(
          execution.externalThreadId,
        );
        expect(THREAD_COMPLETION_STATUSES).toContain(thread.status);

        const messages = await waitForCondition(
          () => getThreadMessages(execution.externalThreadId),
          (threadMessages) =>
            Boolean(findShellExecution(threadMessages).result),
          { timeout: 120_000, interval: 2_000 },
        );

        const shellExecution = findShellExecution(messages);
        expect(shellExecution.toolName).toBe('shell');
        expect(shellExecution.toolCallId).toBeDefined();
        expect(shellExecution.result).toBeDefined();
        expect(shellExecution.result?.exitCode).toBe(0);
        expect(shellExecution.result?.stdout.toLowerCase() ?? '').toContain(
          'gh version',
        );
        expect(typeof shellExecution.result?.stderr).toBe('string');
      },
    );
  });

  describe('Resource validation', () => {
    it('rejects graphs that reference missing resource nodes in shell outputs', async () => {
      const missingNodeId = 'non-existent-resource';
      const invalidGraph = createResourceGraphData({
        includeResource: false,
        resourceEdgeTarget: missingNodeId,
      });

      await expect(graphsService.create(invalidGraph)).rejects.toMatchObject({
        errorCode: 'GRAPH_EDGE_NOT_FOUND',
        statusCode: 400,
        message: expect.stringContaining('non-existent target node'),
      });
    });
  });
});
