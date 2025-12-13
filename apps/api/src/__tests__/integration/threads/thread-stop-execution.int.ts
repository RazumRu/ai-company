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

const COMMAND_AGENT_INSTRUCTIONS =
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands. After running the shell tool, call the finish tool with the stdout (and stderr if present).';

describe('Thread Stop Execution Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

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
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

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
    timeoutMs = 240_000,
  ) => {
    return waitForCondition(
      () => graphsService.findById(graphId),
      (graph) => graph.status === status,
      { timeout: timeoutMs, interval: 1_000 },
    );
  };

  const createShellStopGraphData = (): CreateGraphDto => {
    return {
      name: `Thread Stop Test ${Date.now()}`,
      description: 'Integration test graph for stopping a thread execution',
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
          { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
          { from: AGENT_NODE_ID, to: SHELL_NODE_ID },
          { from: SHELL_NODE_ID, to: RUNTIME_NODE_ID },
        ],
      },
    };
  };

  const createAndRunGraph = async () => {
    const graph = await graphsService.create(createShellStopGraphData());
    registerGraph(graph.id);

    await graphsService.run(graph.id);
    await waitForGraphStatus(graph.id, GraphStatus.Running);
    return graph.id;
  };

  type ShellThreadMessage =
    | Extract<ThreadMessageDto['message'], { role: 'tool-shell' }>
    | Extract<ThreadMessageDto['message'], { role: 'tool' }>;

  const isShellThreadMessage = (
    message: ThreadMessageDto['message'],
  ): message is ShellThreadMessage =>
    (message.role === 'tool-shell' || message.role === 'tool') &&
    message.name === 'shell';

  const getShellExitCode = (messages: ThreadMessageDto[]): number | null => {
    const shellMsg = messages.map((m) => m.message).find(isShellThreadMessage);
    if (!shellMsg) return null;

    const raw =
      shellMsg.role === 'tool-shell'
        ? shellMsg.content
        : shellMsg.role === 'tool'
          ? (shellMsg.content as {
              exitCode?: number;
              stdout?: string;
              stderr?: string;
            })
          : undefined;

    return typeof raw?.exitCode === 'number' ? raw.exitCode : null;
  };

  const extractShellResult = (
    message: ThreadMessageDto['message'],
  ): { exitCode: number; stdout: string; stderr: string } | null => {
    if (!isShellThreadMessage(message)) return null;

    const raw =
      message.role === 'tool-shell'
        ? message.content
        : message.role === 'tool'
          ? (message.content as {
              exitCode?: number;
              stdout?: string;
              stderr?: string;
            })
          : undefined;

    if (
      typeof raw?.exitCode !== 'number' ||
      typeof raw?.stdout !== 'string' ||
      typeof raw?.stderr !== 'string'
    ) {
      return null;
    }

    return {
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
    };
  };

  const getShellResults = (messages: ThreadMessageDto[]) =>
    messages
      .map((m) => extractShellResult(m.message))
      .filter((r): r is { exitCode: number; stdout: string; stderr: string } =>
        Boolean(r),
      );

  const hasShellToolCall = (message: ThreadMessageDto['message']): boolean => {
    if (message.role !== 'ai') return false;
    return (
      Array.isArray(message.toolCalls) &&
      message.toolCalls.some((toolCall) => toolCall.name === 'shell')
    );
  };

  const getThreadMessagesByExternalId = async (externalThreadId: string) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);
    return threadsService.getThreadMessages(thread.id, {
      limit: 200,
      offset: 0,
    });
  };

  it(
    'stopThreadByExternalId aborts a running execution (ThreadUpdate stopped emitted by GraphStateManager)',
    { timeout: 300_000 },
    async () => {
      const graphId = await createAndRunGraph();

      const execution = await graphsService.executeTrigger(
        graphId,
        TRIGGER_NODE_ID,
        {
          messages: ['Run this command: sleep 60'],
          async: true,
          threadSubId: 'stop-by-external-id',
        },
      );

      const runningThread = await waitForCondition(
        () => threadsService.getThreadByExternalId(execution.externalThreadId),
        (t) => t.status === ThreadStatus.Running,
        { timeout: 30_000, interval: 1_000 },
      );

      // Ensure the agent has actually decided to run the shell tool before stopping.
      // Otherwise, there's nothing to "abort" into a deterministic exitCode=124 message.
      await waitForCondition(
        () => getThreadMessagesByExternalId(execution.externalThreadId),
        (messages) => messages.some((m) => hasShellToolCall(m.message)),
        { timeout: 30_000, interval: 1_000 },
      );

      await threadsService.stopThreadByExternalId(execution.externalThreadId);

      const stoppedThread = await waitForCondition(
        () => threadsService.getThreadById(runningThread.id),
        (t) => t.status === ThreadStatus.Stopped,
        { timeout: 60_000, interval: 1_000 },
      );
      expect(stoppedThread.status).toBe(ThreadStatus.Stopped);

      const msgs = await waitForCondition(
        () => getThreadMessagesByExternalId(execution.externalThreadId),
        (messages) => getShellExitCode(messages) !== null,
        { timeout: 60_000, interval: 2_000 },
      );
      expect(getShellExitCode(msgs)).toBe(124);
    },
  );

  it(
    'stopThread (by internal id) aborts a running execution',
    { timeout: 300_000 },
    async () => {
      const graphId = await createAndRunGraph();

      const execution = await graphsService.executeTrigger(
        graphId,
        TRIGGER_NODE_ID,
        {
          messages: ['Run this command: sleep 60'],
          async: true,
          threadSubId: 'stop-by-internal-id',
        },
      );

      const runningThread = await waitForCondition(
        () => threadsService.getThreadByExternalId(execution.externalThreadId),
        (t) => t.status === ThreadStatus.Running,
        { timeout: 30_000, interval: 1_000 },
      );

      await threadsService.stopThread(runningThread.id);

      const stoppedThread = await waitForCondition(
        () => threadsService.getThreadById(runningThread.id),
        (t) => t.status === ThreadStatus.Stopped,
        { timeout: 60_000, interval: 1_000 },
      );
      expect(stoppedThread.status).toBe(ThreadStatus.Stopped);
    },
  );

  it(
    'can stop a running shell thread and then re-trigger the same thread to completion (preserves message history)',
    { timeout: 300_000 },
    async () => {
      const graphId = await createAndRunGraph();

      const threadSubId = `stop-rerun-${Date.now()}`;
      const sleepMessage = 'Run this command: sleep 60';

      const execution1 = await graphsService.executeTrigger(
        graphId,
        TRIGGER_NODE_ID,
        {
          messages: [sleepMessage],
          async: true,
          threadSubId,
        },
      );

      const runningThread = await waitForCondition(
        () => threadsService.getThreadByExternalId(execution1.externalThreadId),
        (t) => t.status === ThreadStatus.Running,
        { timeout: 30_000, interval: 1_000 },
      );

      await waitForCondition(
        () => getThreadMessagesByExternalId(execution1.externalThreadId),
        (messages) => messages.some((m) => hasShellToolCall(m.message)),
        { timeout: 30_000, interval: 1_000 },
      );

      await threadsService.stopThreadByExternalId(execution1.externalThreadId);

      await waitForCondition(
        () => threadsService.getThreadById(runningThread.id),
        (t) => t.status === ThreadStatus.Stopped,
        { timeout: 60_000, interval: 1_000 },
      );

      await waitForCondition(
        () => getThreadMessagesByExternalId(execution1.externalThreadId),
        (messages) => getShellResults(messages).some((r) => r.exitCode === 124),
        { timeout: 60_000, interval: 2_000 },
      );

      const rerunToken = `RERUN_OK_${Date.now()}`;
      const rerunMessage = `Run this command: echo "${rerunToken}"`;

      const execution2 = await graphsService.executeTrigger(
        graphId,
        TRIGGER_NODE_ID,
        {
          messages: [rerunMessage],
          async: false,
          threadSubId,
        },
      );

      expect(execution2.externalThreadId).toBe(execution1.externalThreadId);

      const completedThread = await waitForCondition(
        () => threadsService.getThreadByExternalId(execution2.externalThreadId),
        (t) =>
          t.status === ThreadStatus.Done ||
          t.status === ThreadStatus.NeedMoreInfo,
        { timeout: 60_000, interval: 1_000 },
      );

      const messages = await waitForCondition(
        () =>
          threadsService.getThreadMessages(completedThread.id, {
            limit: 500,
            offset: 0,
          }),
        (msgs) => {
          const humanContents = msgs
            .filter((m) => m.message.role === 'human')
            .map((m) => m.message.content);

          const shellResults = getShellResults(msgs);

          return (
            humanContents.includes(sleepMessage) &&
            humanContents.includes(rerunMessage) &&
            shellResults.some((r) => r.exitCode === 124) &&
            shellResults.some(
              (r) => r.exitCode === 0 && r.stdout.includes(rerunToken),
            )
          );
        },
        { timeout: 120_000, interval: 2_000 },
      );

      const humanContents = messages
        .filter((m) => m.message.role === 'human')
        .map((m) => m.message.content);
      expect(humanContents).toEqual(
        expect.arrayContaining([sleepMessage, rerunMessage]),
      );

      const shellResults = getShellResults(messages);
      expect(shellResults.some((r) => r.exitCode === 124)).toBe(true);
      expect(
        shellResults.some(
          (r) => r.exitCode === 0 && r.stdout.includes(rerunToken),
        ),
      ).toBe(true);
    },
  );
});
