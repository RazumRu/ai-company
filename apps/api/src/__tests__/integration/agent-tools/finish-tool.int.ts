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
import { wait } from '../../test-utils';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

type FinishToolMessage = Extract<ThreadMessageDto['message'], { role: 'tool' }>;

type FinishToolPayload = {
  message: string;
  needsMoreInfo?: boolean;
  purpose?: string;
};

const AGENT_NODE_ID = 'agent-1';
const TRIGGER_NODE_ID = 'trigger-1';

const contextDataStorage = new AuthContextStorage({ sub: TEST_USER_ID });

describe('Finish Tool Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let doneGraphId: string;
  let needMoreInfoGraphId: string;

  const waitForGraphToBeRunning = async (
    graphId: string,
    timeoutMs = 120_000,
  ) => {
    const startedAt = Date.now();

    while (true) {
      const graph = await graphsService.findById(contextDataStorage, graphId);

      if (graph.status === GraphStatus.Running) {
        return graph;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${graphId} did not reach running status within ${timeoutMs}ms (current status: ${graph.status})`,
        );
      }

      await wait(1_000);
    }
  };

  const waitForThreadCompletion = async (
    externalThreadId: string,
    timeoutMs = 120_000,
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
      { timeout: timeoutMs, interval: 1_000 },
    );
  };

  const getThreadMessages = async (
    externalThreadId: string,
  ): Promise<ThreadMessageDto[]> => {
    const thread = await threadsService.getThreadByExternalId(externalThreadId);
    const messages = await threadsService.getThreadMessages(thread.id);

    return messages.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  };

  const isFinishToolMessage = (
    message: ThreadMessageDto['message'],
  ): message is FinishToolMessage =>
    message.role === 'tool' && message.name === 'finish';

  const findFinishToolMessage = (messages: ThreadMessageDto[]) =>
    messages.find(
      (msg): msg is ThreadMessageDto & { message: FinishToolMessage } =>
        isFinishToolMessage(msg.message),
    );

  const createFinishToolGraphData = (
    instructions: string,
    overrides?: Partial<CreateGraphDto['schema']>,
  ): CreateGraphDto => ({
    name: `Finish Tool Integration ${Date.now()}`,
    description: 'Graph that exercises finish tool behavior',
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
            instructions,
            name: 'Test Agent',
            description: 'Test agent description',
            invokeModelName: 'gpt-5-mini',
            invokeModelReasoningEffort: ReasoningEffort.None,
            maxIterations: 50,
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
          } satisfies SimpleAgentSchemaType,
        },
      ],
      edges: [{ from: TRIGGER_NODE_ID, to: AGENT_NODE_ID }],
      ...overrides,
    },
  });

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);

    const doneGraph = await graphsService.create(
      contextDataStorage,
      createFinishToolGraphData(
        'You are a helpful assistant. When you can answer the user directly, call the finish tool with needsMoreInfo=false and include your final response. Always call the finish tool to end your answer even without being reminded.',
      ),
    );
    doneGraphId = doneGraph.id;
    await graphsService.run(contextDataStorage, doneGraphId);
    await waitForGraphToBeRunning(doneGraphId);

    const needMoreInfoGraph = await graphsService.create(
      contextDataStorage,
      createFinishToolGraphData(
        'You are a helpful assistant. When you lack details, call finish with needsMoreInfo=true and ask a single clarifying question.',
      ),
    );
    needMoreInfoGraphId = needMoreInfoGraph.id;
    await graphsService.run(contextDataStorage, needMoreInfoGraphId);
    await waitForGraphToBeRunning(needMoreInfoGraphId);
  }, 180_000);

  afterAll(async () => {
    const graphIds = [doneGraphId, needMoreInfoGraphId].filter(Boolean);
    await Promise.all(
      graphIds.map(async (graphId) => {
        try {
          await graphsService.destroy(contextDataStorage, graphId);
        } catch (error: unknown) {
          if (
            !(error instanceof BaseException) ||
            (error.errorCode !== 'GRAPH_NOT_RUNNING' &&
              error.errorCode !== 'GRAPH_NOT_FOUND')
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
      }),
    );

    await app.close();
  }, 180_000);

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(contextDataStorage, graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(contextDataStorage, graphId);
    await waitForGraphToBeRunning(graphId);
  };

  it(
    'records finish tool response when agent completes a task',
    { timeout: 120_000 },
    async () => {
      await ensureGraphRunning(doneGraphId);

      const execution = await graphsService.executeTrigger(
        contextDataStorage,
        doneGraphId,
        TRIGGER_NODE_ID,
        {
          messages: ['What is your name?'],
          async: false,
          threadSubId: uniqueThreadSubId('finish-done'),
        },
      );

      const thread = await waitForThreadCompletion(execution.externalThreadId);
      expect(thread.status).toBe(ThreadStatus.Done);

      const messages = await getThreadMessages(execution.externalThreadId);
      const finishMessage = findFinishToolMessage(messages);

      expect(finishMessage).toBeDefined();
      const finishPayload = finishMessage!.message.content as FinishToolPayload;
      expect(finishPayload.needsMoreInfo).toBe(false);
      expect(finishPayload.message.length).toBeGreaterThan(0);

      const finishMessages = messages.filter((msg) =>
        isFinishToolMessage(msg.message),
      );
      expect(finishMessages).toHaveLength(1);
    },
  );

  it(
    'sets thread status to need_more_info when finish tool requests clarification',
    { timeout: 120_000 },
    async () => {
      await ensureGraphRunning(needMoreInfoGraphId);

      const execution = await graphsService.executeTrigger(
        contextDataStorage,
        needMoreInfoGraphId,
        TRIGGER_NODE_ID,
        {
          messages: ['Help me with something'],
          async: false,
          threadSubId: uniqueThreadSubId('finish-need-more'),
        },
      );

      const thread = await waitForThreadCompletion(execution.externalThreadId);
      expect(thread.status).toBe(ThreadStatus.NeedMoreInfo);

      const messages = await getThreadMessages(execution.externalThreadId);
      const finishMessage = findFinishToolMessage(messages);
      expect(finishMessage).toBeDefined();

      const finishPayload = finishMessage!.message.content as FinishToolPayload;
      expect(finishPayload.needsMoreInfo).toBe(true);
      expect(finishPayload.message.length).toBeGreaterThan(0);
    },
  );

  it(
    'does not inject tool guard prompts when agent voluntarily calls finish',
    { timeout: 120_000 },
    async () => {
      await ensureGraphRunning(doneGraphId);

      const execution = await graphsService.executeTrigger(
        contextDataStorage,
        doneGraphId,
        TRIGGER_NODE_ID,
        {
          messages: ['What is 2 + 2?'],
          async: false,
          threadSubId: uniqueThreadSubId('finish-voluntary'),
        },
      );

      const thread = await waitForThreadCompletion(execution.externalThreadId);
      expect(thread.status).toBe(ThreadStatus.Done);

      const messages = await getThreadMessages(execution.externalThreadId);
      const guardMessages = messages.filter(
        (msg) =>
          msg.message.role === 'system' &&
          msg.message.content.toLowerCase().includes('call a tool'),
      );
      expect(guardMessages).toHaveLength(0);

      const finishMessage = findFinishToolMessage(messages);
      expect(finishMessage).toBeDefined();
      const finishPayload = finishMessage!.message.content as FinishToolPayload;
      expect(finishPayload.needsMoreInfo).toBe(false);
    },
  );
});
