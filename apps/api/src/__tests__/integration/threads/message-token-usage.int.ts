import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { AgentMessageNotificationHandler } from '../../../v1/notification-handlers/services/event-handlers/agent-message-notification-handler';
import {
  IAgentMessageNotification,
  NotificationEvent,
} from '../../../v1/notifications/notifications.types';
import { serializeBaseMessages } from '../../../v1/notifications/notifications.utils';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Message token usage (integration)', () => {
  let app: INestApplication;
  let graphDao: GraphDao;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let handler: AgentMessageNotificationHandler;

  const createdGraphs: string[] = [];
  const createdThreads: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    graphDao = app.get(GraphDao);
    threadsDao = app.get(ThreadsDao);
    messagesDao = app.get(MessagesDao);
    handler = app.get(AgentMessageNotificationHandler);
  });

  afterEach(async () => {
    for (const threadId of createdThreads) {
      await messagesDao.delete({ threadId });
      await threadsDao.deleteById(threadId);
    }
    createdThreads.length = 0;

    for (const graphId of createdGraphs) {
      await graphDao.deleteById(graphId);
    }
    createdGraphs.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists tokenUsage (totalTokens) on stored messages', async () => {
    const graph = await graphDao.create({
      name: 'token-usage-test-graph',
      description: 'token usage integration test',
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Running,
      metadata: {},
      createdBy: TEST_USER_ID,
      temporary: true,
    });
    createdGraphs.push(graph.id);

    const internalThreadExternalId = `parent-thread-${Date.now()}`;

    const thread = await threadsDao.create({
      graphId: graph.id,
      createdBy: TEST_USER_ID,
      externalThreadId: internalThreadExternalId,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Running,
    });
    createdThreads.push(thread.id);

    const human = new HumanMessage('hi');
    const ai = new AIMessage('hello');
    human.additional_kwargs = {
      __tokenUsage: { totalTokens: 2, totalPrice: 0.01 },
    };
    ai.additional_kwargs = {
      __tokenUsage: { totalTokens: 3, totalPrice: 0.02 },
    };

    const serializedMessages = serializeBaseMessages([human, ai]);

    const event: IAgentMessageNotification = {
      type: NotificationEvent.AgentMessage,
      graphId: graph.id,
      nodeId: 'agent-1',
      threadId: `external-thread-${Date.now()}`,
      parentThreadId: internalThreadExternalId,
      data: {
        messages: serializedMessages,
      },
    };

    const enriched = await handler.handle(event);

    expect(enriched).toHaveLength(2);

    const stored = await messagesDao.getAll({
      threadId: thread.id,
      order: { createdAt: 'ASC' },
    });

    expect(stored).toHaveLength(2);

    const aiStored = stored.find((m) => m.message.role === 'ai');
    expect(aiStored).toBeDefined();
    expect(aiStored?.requestTokenUsage).toEqual({
      totalTokens: 3,
      totalPrice: 0.02,
    });

    const humanStored = stored.find((m) => m.message.role === 'human');
    expect(humanStored).toBeDefined();
    expect(humanStored?.requestTokenUsage).toEqual({
      totalTokens: 2,
      totalPrice: 0.01,
    });

    const aiNotification = enriched.find((n) => n.data.message.role === 'ai');
    expect(aiNotification?.data.requestTokenUsage).not.toBeNull();
    expect(aiNotification?.data.requestTokenUsage?.totalTokens).toBeGreaterThan(
      0,
    );
  });
});
