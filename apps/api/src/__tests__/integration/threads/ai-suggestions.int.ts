import { INestApplication } from '@nestjs/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphEntity } from '../../../v1/graphs/entity/graph.entity';
import { GraphStatus, NodeKind } from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { OpenaiService } from '../../../v1/openai/openai.service';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadEntity } from '../../../v1/threads/entity/thread.entity';
import { AiSuggestionsService } from '../../../v1/threads/services/ai-suggestions.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('AiSuggestionsService (integration)', () => {
  let app: INestApplication;
  let aiSuggestionsService: AiSuggestionsService;
  let graphRegistry: GraphRegistry;
  let graphDao: GraphDao;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;

  const createdGraphs: string[] = [];
  const createdThreads: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    aiSuggestionsService = app.get(AiSuggestionsService);
    graphRegistry = app.get(GraphRegistry);
    graphDao = app.get(GraphDao);
    threadsDao = app.get(ThreadsDao);
    messagesDao = app.get(MessagesDao);
  });

  afterEach(async () => {
    for (const threadId of createdThreads) {
      await messagesDao.delete({ threadId });
      await threadsDao.deleteById(threadId);
    }
    createdThreads.length = 0;

    for (const graphId of createdGraphs) {
      await graphRegistry.destroy(graphId).catch(() => undefined);
      await graphDao.deleteById(graphId);
    }
    createdGraphs.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'analyzes a thread and calls LLM with cleaned messages',
    { timeout: 30000 },
    async () => {
      const graph = (await graphDao.create({
        name: 'ai-suggestions-graph',
        description: 'test graph',
        error: null,
        version: '1.0.0',
        targetVersion: '1.0.0',
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: { name: 'Primary agent', instructions: 'Do it' },
            },
            { id: 'tool-1', template: 'search-tool', config: {} },
          ],
          edges: [{ from: 'agent-1', to: 'tool-1' }],
        },
        status: GraphStatus.Running,
        metadata: {},
        createdBy: TEST_USER_ID,
        temporary: false,
      })) as GraphEntity;
      createdGraphs.push(graph.id);

      graphRegistry.register(graph.id, {
        nodes: new Map([
          [
            'agent-1',
            {
              id: 'agent-1',
              type: NodeKind.SimpleAgent,
              template: 'simple-agent',
              instance: {} as unknown,
              config: { name: 'Primary agent', instructions: 'Do it' },
            },
          ],
          [
            'tool-1',
            {
              id: 'tool-1',
              type: NodeKind.Tool,
              template: 'search-tool',
              instance: {
                name: 'Search',
                description: 'Search the web',
                __instructions: 'Use it wisely',
              },
              config: {},
            },
          ],
        ]),
        edges: [{ from: 'agent-1', to: 'tool-1' }],
        state: {} as never,
        destroy: async () => undefined,
        status: GraphStatus.Running,
      });

      const thread = (await threadsDao.create({
        graphId: graph.id,
        createdBy: TEST_USER_ID,
        externalThreadId: 'ext-thread-1',
        metadata: {},
        source: null,
        name: 'Test thread',
        status: ThreadStatus.Running,
      })) as ThreadEntity;
      createdThreads.push(thread.id);

      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: { role: 'system', content: 'System intro' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: { role: 'human', content: 'Hello' },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'agent-1',
        message: {
          role: 'ai',
          content: 'Calling tool',
          toolCalls: [
            {
              name: 'search',
              args: { query: 'hi' },
              type: 'tool_call',
              id: 'call-1',
            },
          ],
        },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'tool-1',
        message: {
          role: 'tool',
          name: 'search',
          content: { result: 'ok' },
          toolCallId: '1',
        },
      });
      await messagesDao.create({
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        nodeId: 'tool-1',
        message: {
          role: 'tool-shell',
          name: 'shell',
          content: { stdout: 'done', stderr: '', exitCode: 0 },
          toolCallId: '2',
        },
      });

      const openaiService = app.get(OpenaiService);
      const responseMock = vi
        .spyOn(openaiService, 'response')
        .mockResolvedValue({
          content: 'Analysis result',
          conversationId: 'conv-123',
        });

      const result = await aiSuggestionsService.analyzeThread(thread.id, {
        userInput: 'Please check tools',
        threadId: 'conv-prev',
      });

      expect(result).toEqual({
        analysis: 'Analysis result',
        conversationId: 'conv-123',
      });

      expect(responseMock).toHaveBeenCalledTimes(1);
      const [payload, params] = responseMock.mock.calls[0] as [
        { message: string },
        { previous_response_id?: string },
      ];
      expect(params.previous_response_id).toBe('conv-prev');
      expect(payload.message).toContain(
        '<<<BLOCK id=information purpose="General information">>>',
      );
      expect(payload.message).toContain('User request:');
      expect(payload.message).toContain('Please check tools');
      expect(payload.message).toContain('<<<END BLOCK id=information>>>');
      expect(payload.message).toContain(
        '<<<BLOCK id=agents purpose="Providing information about agents">>>',
      );
      expect(payload.message).toContain(
        '<<<SUBBLOCK id=agent_agent-1 name="Primary agent">>>',
      );
      expect(payload.message).toContain('Agent Primary agent (simple-agent)');
      expect(payload.message).toContain('Instructions:');
      expect(payload.message).toContain('Do it');
      expect(payload.message).toContain('<<<END SUBBLOCK id=agent_agent-1>>>');
      expect(payload.message).toContain('<<<END BLOCK id=agents>>>');
      expect(payload.message).toContain(
        '<<<BLOCK id=messages purpose="Thread messages">>>',
      );
      expect(payload.message).toContain('Thread messages (oldest first):');
      expect(payload.message).toContain('system message from Primary agent');
      expect(payload.message).toContain('human message from Primary agent');
      expect(payload.message).toContain('ai message from Primary agent');
      expect(payload.message).toContain('tool message from Search');
      expect(payload.message).toContain('tool-shell message from Search');
      expect(payload.message).toContain('toolCalls');
      expect(payload.message).toContain('<<<END BLOCK id=messages>>>');
    },
  );
});
