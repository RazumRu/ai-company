import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const THREAD_COMPLETION_STATUS = ThreadStatus.Done;

describe('Graph Resources Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let resourceGraphId: string;

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

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 180_000,
  ) => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);

    return waitForCondition(
      () => threadsService.getThreadById(thread.id),
      (currentThread) => currentThread.status === THREAD_COMPLETION_STATUS,
      { timeout: timeoutMs, interval: 1_000 },
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

  type ShellThreadMessage = Extract<
    ThreadMessageDto['message'],
    { role: 'tool' }
  >;

  const isShellThreadMessage = (
    message: ThreadMessageDto['message'],
  ): message is ShellThreadMessage =>
    message.role === 'tool' && message.name === 'shell';

  const findShellExecution = (messages: ThreadMessageDto[]) => {
    const aiMessage = messages
      .map((message) => message.message)
      .find(isAiThreadMessage);

    const shellToolCall = aiMessage?.toolCalls?.find(
      (toolCall) => toolCall.name === 'shell',
    );
    const shellToolCallId = shellToolCall?.id;

    const shellMessage = messages
      .map((message) => message.message)
      .find(
        (message): message is ShellThreadMessage =>
          isShellThreadMessage(message) &&
          (shellToolCallId ? message.toolCallId === shellToolCallId : true),
      );

    const rawResult =
      shellMessage?.role === 'tool'
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
      toolCallId: shellToolCallId ?? shellMessage?.toolCallId,
      result,
    };
  };

  const createResourceGraphData = (): CreateGraphDto => {
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
          name: 'Test Agent',
          description: 'Test agent description',
          summarizeMaxTokens: 272000,
          summarizeKeepTokens: 30000,
          invokeModelName: 'gpt-5-mini',
          invokeModelReasoningEffort: ReasoningEffort.None,
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
          initScript: [
            'apt-get update',
            'apt-get install -y curl git',
            'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
            'chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg',
            'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
            'apt-get update',
            'apt-get install -y gh',
          ],
        },
      },
    ];

    nodes.push({
      id: GITHUB_RESOURCE_NODE_ID,
      template: 'github-resource',
      config: {
        patToken: 'mock-token-for-testing',
        auth: false,
      },
    });

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
          { from: SHELL_NODE_ID, to: GITHUB_RESOURCE_NODE_ID },
        ],
      },
    };
  };

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
    const graph = await graphsService.create(createResourceGraphData());
    resourceGraphId = graph.id;

    await graphsService.run(resourceGraphId);
    await waitForGraphStatus(resourceGraphId, GraphStatus.Running, 240_000);
  }, 300_000);

  afterAll(async () => {
    if (resourceGraphId) {
      await cleanupGraph(resourceGraphId);
    }
    await app.close();
  }, 300_000);

  const ensureGraphRunning = async () => {
    const graph = await graphsService.findById(resourceGraphId);
    if (graph.status === GraphStatus.Running) return;

    await graphsService.run(resourceGraphId);
    await waitForGraphStatus(resourceGraphId, GraphStatus.Running, 240_000);
  };

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  describe('GitHub resource execution', () => {
    it(
      'propagates GitHub resource env and init config to shell tool',
      { timeout: 240_000 },
      async () => {
        await ensureGraphRunning();

        const execution = await graphsService.executeTrigger(
          resourceGraphId,
          TRIGGER_NODE_ID,
          {
            messages: [
              'Run this command: printf "TOKEN=%s\\n" "$GITHUB_PAT_TOKEN"; gh config get git_protocol; gh --version',
            ],
            async: false,
            threadSubId: uniqueThreadSubId('gh-resource'),
          },
        );

        expect(execution.externalThreadId).toBeDefined();

        const thread = await waitForThreadCompletion(
          execution.externalThreadId,
          180_000,
        );
        expect(thread.status).toBe(THREAD_COMPLETION_STATUS);

        const messages = await waitForCondition(
          () => getThreadMessages(execution.externalThreadId),
          (threadMessages) =>
            Boolean(findShellExecution(threadMessages).result),
          { timeout: 180_000, interval: 2_000 },
        );

        const shellExecution = findShellExecution(messages);
        expect(shellExecution.toolName).toBe('shell');
        expect(shellExecution.toolCallId).toBeDefined();
        expect(shellExecution.result).toBeDefined();
        expect(
          shellExecution.result?.exitCode,
          shellExecution.result?.stderr ?? 'missing shell stderr',
        ).toBe(0);
        expect(shellExecution.result?.stdout).toContain(
          'TOKEN=mock-token-for-testing',
        );
        expect(shellExecution.result?.stdout.toLowerCase() ?? '').toContain(
          'https',
        );
        expect(shellExecution.result?.stdout.toLowerCase() ?? '').toContain(
          'gh version',
        );
        expect(typeof shellExecution.result?.stderr).toBe('string');
      },
    );
  });
});
