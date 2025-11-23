import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
import { CreateGraphDto } from '../../../v1/graphs/dto/graphs.dto';
import {
  GraphNodeSchemaType,
  GraphStatus,
} from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { wait } from '../../test-utils';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const DOCKER_RUNTIME_NODE_ID = 'runtime-1';
const SHELL_TOOL_NODE_ID = 'shell-tool-1';
const AGENT_NODE_ID = 'agent-1';
const TRIGGER_NODE_ID = 'trigger-1';
const DOCKER_PS_COMMAND =
  'Use the shell tool to execute this command: docker ps';

describe('Docker-in-Docker Integration', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

  const waitForGraphToBeRunning = async (
    graphId: string,
    timeoutMs = 120000,
  ) => {
    const startedAt = Date.now();

    while (true) {
      const graph = await graphsService.findById(graphId);

      if (graph.status === GraphStatus.Running) {
        return graph;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${graphId} did not reach running status within ${timeoutMs}ms (current status: ${graph.status})`,
        );
      }

      await wait(1000);
    }
  };

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 120000,
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

  type ShellThreadMessage =
    | Extract<ThreadMessageDto['message'], { role: 'tool-shell' }>
    | Extract<ThreadMessageDto['message'], { role: 'tool' }>;

  const isAiThreadMessage = (
    message: ThreadMessageDto['message'],
  ): message is Extract<ThreadMessageDto['message'], { role: 'ai' }> =>
    message.role === 'ai';

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

  const findShellExecution = (messages: ThreadMessageDto[]) => {
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

  const removeGraphFromCleanup = (graphId: string) => {
    const index = createdGraphIds.indexOf(graphId);
    if (index >= 0) {
      createdGraphIds.splice(index, 1);
    }
  };

  const createDockerInDockerGraphData = (): CreateGraphDto => ({
    name: `Docker-in-Docker Test Graph ${Date.now()}`,
    description:
      'Validates docker runtime graph that uses shell tool to reach a nested Docker daemon',
    temporary: true,
    schema: {
      nodes: [
        {
          id: TRIGGER_NODE_ID,
          template: 'manual-trigger',
          config: {},
        },
        {
          id: AGENT_NODE_ID,
          template: 'simple-agent',
          config: {
            instructions:
              'You are a shell command executor agent. When the user asks you to execute a command, you MUST use the shell tool to execute it. Always respond with the stdout from the shell tool.',
            invokeModelName: 'gpt-5-mini',
            enforceToolUsage: true,
            maxIterations: 50,
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
          } satisfies SimpleAgentSchemaType,
        },
        {
          id: SHELL_TOOL_NODE_ID,
          template: 'shell-tool',
          config: {},
        },
        {
          id: DOCKER_RUNTIME_NODE_ID,
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: 'node:20-alpine',
            env: {},
            initScript: 'apk add --no-cache docker-cli',
            initScriptTimeoutMs: 60000,
            enableDind: true,
          },
        },
      ],
      edges: [
        { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
        { from: AGENT_NODE_ID, to: SHELL_TOOL_NODE_ID },
        { from: SHELL_TOOL_NODE_ID, to: DOCKER_RUNTIME_NODE_ID },
      ],
    },
  });

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
  });

  afterAll(async () => {
    await Promise.all(
      createdGraphIds.map(async (graphId) => {
        try {
          await graphsService.destroy(graphId);
        } catch (error: unknown) {
          if (
            !(error instanceof BaseException) ||
            (error.errorCode !== 'GRAPH_NOT_RUNNING' &&
              error.errorCode !== 'GRAPH_NOT_FOUND')
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
            !(error instanceof BaseException) ||
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

  it(
    'runs docker runtime with DIND enabled and executes docker commands through the shell tool',
    { timeout: 180000 },
    async () => {
      const graphData = createDockerInDockerGraphData();

      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      expect(createResponse.status).toBe(GraphStatus.Created);

      const runtimeNode = createResponse.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === DOCKER_RUNTIME_NODE_ID,
      );
      expect(runtimeNode).toBeDefined();
      expect(runtimeNode?.template).toBe('docker-runtime');
      expect(runtimeNode?.config.enableDind).toBe(true);
      expect(runtimeNode?.config.initScript).toContain('docker-cli');

      const runResponse = await graphsService.run(graphId);
      expect(runResponse.status).toBe(GraphStatus.Running);

      await waitForGraphToBeRunning(graphId);

      const execution = await graphsService.executeTrigger(
        graphId,
        TRIGGER_NODE_ID,
        {
          messages: [DOCKER_PS_COMMAND],
          threadSubId: 'docker-ps-test',
          async: false,
        },
      );

      expect(execution.externalThreadId).toBeDefined();

      const thread = await waitForThreadCompletion(execution.externalThreadId);
      expect(
        [
          ThreadStatus.Done,
          ThreadStatus.NeedMoreInfo,
          ThreadStatus.Stopped,
        ].includes(thread.status),
      ).toBe(true);

      const messages = await waitForCondition(
        () => getThreadMessages(execution.externalThreadId),
        (msgs) => Boolean(findShellExecution(msgs)?.result),
        { timeout: 60000, interval: 1000 },
      );

      const shellExecution = findShellExecution(messages);
      expect(shellExecution?.toolName).toBe('shell');
      expect(shellExecution?.toolCallId).toBeDefined();
      expect(shellExecution?.result?.exitCode).toBe(0);

      const stdout = shellExecution?.result?.stdout ?? '';
      expect(stdout.length).toBeGreaterThan(0);
      expect(/CONTAINER|IMAGE/i.test(stdout)).toBe(true);

      const destroyResponse = await graphsService.destroy(graphId);
      expect(destroyResponse.status).toBe(GraphStatus.Stopped);

      await graphsService.delete(graphId);

      await expect(graphsService.findById(graphId)).rejects.toMatchObject({
        errorCode: 'GRAPH_NOT_FOUND',
      });

      removeGraphFromCleanup(graphId);
    },
  );
});
