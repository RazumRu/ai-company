import { ToolMessage } from '@langchain/core/messages';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { MessageTransformerService } from '../../../v1/graphs/services/message-transformer.service';
import { serializeBaseMessages } from '../../../v1/notifications/notifications.utils';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Web search tool integration', () => {
  let messageTransformer: MessageTransformerService;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let threadsService: ThreadsService;
  let graphDao: GraphDao;
  let createdThreadId: string;
  let createdGraphId: string;

  beforeAll(async () => {
    const app = await createTestModule();
    messageTransformer = app.get<MessageTransformerService>(
      MessageTransformerService,
    );
    threadsDao = app.get<ThreadsDao>(ThreadsDao);
    messagesDao = app.get<MessagesDao>(MessagesDao);
    threadsService = app.get<ThreadsService>(ThreadsService);
    graphDao = app.get<GraphDao>(GraphDao);

    const graph = await graphDao.create({
      name: 'web-search-tool-test-graph',
      description: 'Integration test graph for web search tool',
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      metadata: {},
      createdBy: TEST_USER_ID,
      temporary: true,
    });
    createdGraphId = graph.id;

    const thread = await threadsDao.create({
      graphId: createdGraphId,
      createdBy: TEST_USER_ID,
      externalThreadId: `ext-${Date.now()}`,
      status: ThreadStatus.Running,
      metadata: {},
    });

    createdThreadId = thread.id;
  });

  afterAll(async () => {
    if (createdThreadId) {
      await messagesDao.delete({ threadId: createdThreadId });
      await threadsDao.delete({ id: createdThreadId });
    }
    if (createdGraphId) {
      await graphDao.deleteById(createdGraphId);
    }
  });

  it('stores tool call title from metadata in message DTO and DB', async () => {
    const title = 'Search in internet: cats';
    const toolMsg = new ToolMessage({
      content: JSON.stringify({ result: 'ok' }),
      name: 'web_search',
      tool_call_id: 'call-1',
      additional_kwargs: { __title: title },
    });

    const [serialized] = serializeBaseMessages([toolMsg]);
    if (!serialized) {
      throw new Error('Failed to serialize tool message');
    }
    const dto = messageTransformer.transformMessageToDto(serialized);
    expect(dto.role).toBe('tool');
    if (dto.role !== 'tool') return;
    expect(dto.title).toBe(title);
    expect(dto.additionalKwargs?.__title).toBe(title);

    await messagesDao.create({
      threadId: createdThreadId,
      externalThreadId: 'ext-unused',
      nodeId: 'agent-1',
      message: dto,
    });

    const messages = await threadsService.getThreadMessages(createdThreadId);
    const storedTool = messages.find(
      (m: ThreadMessageDto) =>
        m.message.role === 'tool' && m.message.name === 'web_search',
    );

    expect(storedTool).toBeDefined();
    if (!storedTool || storedTool.message.role !== 'tool') return;
    expect(storedTool.message.title).toBe(title);
    expect(storedTool.message.additionalKwargs?.__title).toBe(title);
  });
});
