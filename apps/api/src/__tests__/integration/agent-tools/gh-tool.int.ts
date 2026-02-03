import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
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
import { createTestModule, TEST_USER_ID } from '../setup';

const TRIGGER_NODE_ID = 'trigger-1';
const AGENT_NODE_ID = 'agent-1';
const GH_TOOL_NODE_ID = 'gh-tool-1';
const RUNTIME_NODE_ID = 'runtime-1';
const GITHUB_RESOURCE_NODE_ID = 'github-resource-1';

const GH_CLONE_AGENT_INSTRUCTIONS = `You are a GitHub repository cloning assistant. When the user asks you to clone a repository, use the gh_clone tool with the owner and repo name. After cloning, call the finish tool with the cloned repository path.`;

const THREAD_COMPLETION_STATUSES: ThreadStatus[] = [
  ThreadStatus.Done,
  ThreadStatus.NeedMoreInfo,
];

const contextDataStorage = new AuthContextStorage({ sub: TEST_USER_ID });

describe('GitHub Tool Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let ghGraphId: string;

  const cleanupGraph = async (graphId: string) => {
    try {
      await graphsService.destroy(contextDataStorage, graphId);
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
      await graphsService.delete(contextDataStorage, graphId);
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
      () => graphsService.findById(contextDataStorage, graphId),
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

  type GhCloneThreadMessage = Extract<
    ThreadMessageDto['message'],
    { role: 'tool' }
  >;

  const isGhCloneThreadMessage = (
    message: ThreadMessageDto['message'],
    toolName: string,
  ): message is GhCloneThreadMessage =>
    message.role === 'tool' && message.name === toolName;

  const findToolExecution = (
    messages: ThreadMessageDto[],
    toolName: string,
  ) => {
    const toolMessage = messages
      .map((message) => message.message)
      .find((msg) => isGhCloneThreadMessage(msg, toolName));

    if (toolMessage) {
      const rawResult =
        toolMessage.role === 'tool'
          ? (toolMessage.content as { path?: string; error?: string })
          : undefined;

      let result: unknown;
      try {
        result =
          typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      } catch {
        result = rawResult;
      }
      return {
        toolName: toolMessage.name,
        toolCallId: toolMessage.toolCallId,
        result,
      };
    }
    return { toolName: undefined, toolCallId: undefined, result: undefined };
  };

  const createGhToolGraphData = (): CreateGraphDto => {
    return {
      name: `GitHub Tool Graph ${Date.now()}`,
      description: 'Integration test graph for GitHub tool',
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
              instructions: GH_CLONE_AGENT_INSTRUCTIONS,
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
            id: GH_TOOL_NODE_ID,
            template: 'gh-tool',
            config: {},
          },
          {
            id: RUNTIME_NODE_ID,
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'python:3.11-slim',
              env: {},
              initScript:
                'apt-get update && apt-get install -y curl && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && apt-get update && apt-get install -y gh',
              initScriptTimeoutMs: 300000,
            },
          },
          {
            id: GITHUB_RESOURCE_NODE_ID,
            template: 'github-resource',
            config: {
              patToken: 'mock-token-for-testing',
              auth: false,
            },
          },
        ],
        edges: [
          { from: TRIGGER_NODE_ID, to: AGENT_NODE_ID },
          { from: AGENT_NODE_ID, to: GH_TOOL_NODE_ID },
          { from: GH_TOOL_NODE_ID, to: RUNTIME_NODE_ID },
          { from: GH_TOOL_NODE_ID, to: GITHUB_RESOURCE_NODE_ID },
        ],
      },
    };
  };

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
    const graph = await graphsService.create(
      contextDataStorage,
      createGhToolGraphData(),
    );
    ghGraphId = graph.id;
    await graphsService.run(contextDataStorage, ghGraphId);
    await waitForGraphStatus(ghGraphId, GraphStatus.Running, 300_000);
  }, 360_000);

  afterAll(async () => {
    if (ghGraphId) {
      await cleanupGraph(ghGraphId);
    }
    await app.close();
  }, 360_000);

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(contextDataStorage, graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(contextDataStorage, graphId);
    await waitForGraphStatus(graphId, GraphStatus.Running, 300_000);
  };

  describe('GitHub clone tool execution', () => {
    it(
      'creates a graph with GitHub tool + runtime + resource nodes',
      { timeout: 120_000 },
      async () => {
        const graph = await graphsService.findById(
          contextDataStorage,
          ghGraphId,
        );
        expect(graph.id).toBeDefined();
        expect([GraphStatus.Created, GraphStatus.Running]).toContain(
          graph.status,
        );
        const nodeIds = graph.schema.nodes.map((n) => n.id);
        expect(nodeIds).toEqual(
          expect.arrayContaining([
            TRIGGER_NODE_ID,
            AGENT_NODE_ID,
            GH_TOOL_NODE_ID,
            RUNTIME_NODE_ID,
            GITHUB_RESOURCE_NODE_ID,
          ]),
        );
      },
    );

    it(
      'executes GitHub clone tool when agent requests repository clone',
      { timeout: 120000 },
      async () => {
        await ensureGraphRunning(ghGraphId);

        const execution = await graphsService.executeTrigger(
          contextDataStorage,
          ghGraphId,
          TRIGGER_NODE_ID,
          {
            messages: [
              'Clone the repository octocat/Hello-World. Use the gh_clone tool.',
            ],
            async: false,
            threadSubId: uniqueThreadSubId('gh-clone'),
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
            Boolean(findToolExecution(threadMessages, 'gh_clone').result),
          { timeout: 120_000, interval: 2_000 },
        );

        const ghCloneExecution = findToolExecution(messages, 'gh_clone');
        expect(ghCloneExecution.toolName).toBe('gh_clone');
        expect(ghCloneExecution.toolCallId).toBeDefined();
        expect(ghCloneExecution.result).toBeDefined();

        // The result should contain either a path (success) or error
        if (
          ghCloneExecution.result &&
          typeof ghCloneExecution.result === 'object'
        ) {
          const result = ghCloneExecution.result as {
            path?: string;
            error?: string;
          };
          // In a real scenario, if the PAT token is invalid, we'd get an error
          // But since we're using a mock token, we expect either:
          // 1. An error (if authentication fails)
          // 2. A path (if the clone succeeds somehow)
          expect(result.path || result.error).toBeDefined();
        }
      },
    );

    it(
      'handles GitHub tool with missing resource node gracefully',
      { timeout: 120_000 },
      async () => {
        const graphData = createGhToolGraphData();
        // Remove the GitHub resource node
        graphData.schema.nodes = graphData.schema.nodes.filter(
          (node) => node.id !== GITHUB_RESOURCE_NODE_ID,
        );
        // Remove the edge to the resource
        if (graphData.schema.edges) {
          graphData.schema.edges = graphData.schema.edges.filter(
            (edge) => edge.to !== GITHUB_RESOURCE_NODE_ID,
          );
        }

        await expect(
          graphsService.create(contextDataStorage, graphData),
        ).rejects.toMatchObject({
          errorCode: expect.any(String),
          statusCode: expect.any(Number),
        });
      },
    );

    it(
      'handles GitHub tool with missing runtime node gracefully',
      { timeout: 120_000 },
      async () => {
        const graphData = createGhToolGraphData();
        // Remove the runtime node
        graphData.schema.nodes = graphData.schema.nodes.filter(
          (node) => node.id !== RUNTIME_NODE_ID,
        );
        // Remove the edge to the runtime
        if (graphData.schema.edges) {
          graphData.schema.edges = graphData.schema.edges.filter(
            (edge) => edge.to !== RUNTIME_NODE_ID,
          );
        }

        await expect(
          graphsService.create(contextDataStorage, graphData),
        ).rejects.toMatchObject({
          errorCode: expect.any(String),
          statusCode: expect.any(Number),
        });
      },
    );
  });
});
