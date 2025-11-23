import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

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
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, call the finish tool with the stdout (and stderr if present). If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

const THREAD_COMPLETION_STATUSES: ThreadStatus[] = [
  ThreadStatus.Done,
  ThreadStatus.NeedMoreInfo,
  ThreadStatus.Stopped,
];

describe('Shell Execution Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

  type ShellExecutionSummary = ReturnType<typeof findShellExecution>;

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

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 180_000,
  ) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);

    return waitForCondition(
      () => threadsService.getThreadById(thread.id),
      (currentThread) =>
        THREAD_COMPLETION_STATUSES.includes(currentThread.status),
      {
        timeout: timeoutMs,
        interval: 1_000,
      },
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

  const waitForShellExecution = async (
    externalThreadId: string,
    predicate: (summary: ShellExecutionSummary) => boolean = (summary) =>
      Boolean(summary.result),
    timeoutMs = 180_000,
  ) => {
    return waitForCondition(
      () => getThreadMessages(externalThreadId),
      (threadMessages) => predicate(findShellExecution(threadMessages)),
      { timeout: timeoutMs, interval: 2_000 },
    );
  };

  interface ShellGraphOptions {
    env?: Record<string, string>;
    dockerImage?: string;
    agentInstructions?: string;
    description?: string;
  }

  const createShellExecutionGraphData = (
    options: ShellGraphOptions = {},
  ): CreateGraphDto => {
    const {
      env = {},
      dockerImage = 'python:3.11-slim',
      agentInstructions = COMMAND_AGENT_INSTRUCTIONS,
      description = 'Integration test graph for shell execution',
    } = options;

    return {
      name: `Shell Execution Test ${Date.now()}`,
      description,
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
              instructions: agentInstructions,
              summarizeMaxTokens: 272000,
              summarizeKeepTokens: 30000,
              invokeModelName: 'gpt-5-mini',
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
              image: dockerImage,
              env,
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

  const createAndRunShellGraph = async (options?: ShellGraphOptions) => {
    const graph = await graphsService.create(
      createShellExecutionGraphData(options),
    );
    registerGraph(graph.id);

    await graphsService.run(graph.id);
    await waitForGraphStatus(graph.id, GraphStatus.Running);

    return graph.id;
  };

  interface ExecuteShellOptions {
    threadSubId?: string;
    shellResultTimeoutMs?: number;
    predicate?: (summary: ShellExecutionSummary) => boolean;
  }

  const executeShellScenario = async (
    graphId: string,
    message: string,
    options: ExecuteShellOptions = {},
  ) => {
    const execution = await graphsService.executeTrigger(
      graphId,
      TRIGGER_NODE_ID,
      {
        messages: [message],
        async: false,
        threadSubId: options.threadSubId,
      },
    );

    expect(execution.externalThreadId).toBeDefined();

    const thread = await waitForThreadCompletion(execution.externalThreadId);
    expect(THREAD_COMPLETION_STATUSES).toContain(thread.status);

    const messages = await waitForShellExecution(
      execution.externalThreadId,
      options.predicate,
      options.shellResultTimeoutMs,
    );

    const summary = findShellExecution(messages);
    expect(summary.toolName).toBe('shell');
    expect(summary.toolCallId).toBeDefined();
    expect(summary.result).toBeDefined();

    return summary;
  };

  describe('Runtime shell command execution', () => {
    it(
      'runs a simple shell command end-to-end',
      { timeout: 240_000 },
      async () => {
        const graphId = await createAndRunShellGraph({
          env: { FOO: 'bar' },
        });

        const result = await executeShellScenario(
          graphId,
          'Execute the command: echo "Hello from integration test"',
        );

        expect(result.result?.exitCode).toBe(0);
        expect(
          result.result?.stdout
            .toLowerCase()
            .includes('hello from integration'),
        ).toBe(true);
      },
    );

    it(
      'propagates runtime environment variables into the shell tool',
      { timeout: 240_000 },
      async () => {
        const graphId = await createAndRunShellGraph({
          env: { FOO: 'bar' },
        });

        const result = await executeShellScenario(
          graphId,
          'Execute the shell command to print environment variable: echo $FOO',
        );

        expect(result.result?.exitCode).toBe(0);
        expect(result.result?.stdout).toContain('bar');
      },
    );
  });

  describe('Custom runtime images', () => {
    it(
      'executes commands in an alpine runtime',
      { timeout: 300_000 },
      async () => {
        const graphId = await createAndRunShellGraph({
          dockerImage: 'alpine:latest',
        });

        const result = await executeShellScenario(
          graphId,
          'Execute the shell command: uname -a',
          { shellResultTimeoutMs: 240_000 },
        );

        expect(result.result?.exitCode).toBe(0);
        expect(result.result?.stdout.toLowerCase()).toContain('linux');
      },
    );
  });

  describe('Shell command error handling', () => {
    it(
      'surfaces stderr for invalid commands',
      { timeout: 240_000 },
      async () => {
        const graphId = await createAndRunShellGraph();

        const result = await executeShellScenario(
          graphId,
          'Run this command: invalidcommandthatdoesnotexist',
        );

        expect(result.result?.exitCode).not.toBe(0);
        expect(result.result?.stderr.toLowerCase()).toContain(
          'invalidcommandthatdoesnotexist',
        );
      },
    );

    it(
      'returns non-zero exit codes for failing commands',
      { timeout: 240_000 },
      async () => {
        const graphId = await createAndRunShellGraph();

        const result = await executeShellScenario(
          graphId,
          'Run this command: ls /nonexistentpath',
        );

        expect(result.result?.exitCode).not.toBe(0);
        expect(result.result?.stderr.toLowerCase()).toContain('no such file');
      },
    );
  });

  describe('Shell command timeout behavior', () => {
    it(
      'applies overall timeout for long running commands',
      { timeout: 300_000 },
      async () => {
        const graphId = await createAndRunShellGraph();

        const result = await executeShellScenario(
          graphId,
          'Execute this command with a 2-second timeout: sleep 5',
          {
            predicate: (summary) =>
              summary.result?.exitCode === 124 || Boolean(summary.result),
          },
        );

        expect(result.result?.exitCode).toBe(124);
      },
    );

    it(
      'completes when the command keeps producing output within tail timeout',
      { timeout: 300_000 },
      async () => {
        const graphId = await createAndRunShellGraph();

        const result = await executeShellScenario(
          graphId,
          'Execute this command that will stop producing output: echo "start"; sleep 3; echo "end"',
        );

        expect(result.result?.exitCode).toBe(0);
        expect(result.result?.stdout).toContain('start');
        expect(result.result?.stdout).toContain('end');
      },
    );

    it(
      'does not hit timeouts for quick commands',
      { timeout: 240_000 },
      async () => {
        const graphId = await createAndRunShellGraph();

        const result = await executeShellScenario(
          graphId,
          'Execute this quick command: echo "success"',
        );

        expect(result.result?.exitCode).toBe(0);
        expect(result.result?.stdout).toContain('success');
      },
    );
  });
});
