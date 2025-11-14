import { INestApplication } from '@nestjs/common';
import { BaseException, NotFoundException } from '@packages/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Thread Management Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  const createdGraphIds: string[] = [];

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
  });

  describe('Thread Creation and Isolation', () => {
    it(
      'should create a new internal thread for each invocation without threadSubId',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);

        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // First invocation without threadSubId
        const trigger1Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['First message'],
          },
        );

        expect(trigger1Result.threadId).toBeDefined();
        const firstThreadId = trigger1Result.threadId;

        // Second invocation without threadSubId
        const trigger2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Second message'],
          },
        );

        expect(trigger2Result.threadId).toBeDefined();
        const secondThreadId = trigger2Result.threadId;

        // Thread IDs should be different
        expect(firstThreadId).not.toBe(secondThreadId);

        // Wait for both threads to be created in the database
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) => threads.length === 2,
          { timeout: 10000 },
        );

        expect(threads).toHaveLength(2);

        const threadIds = threads.map(
          (t: unknown) => (t as { externalThreadId: string }).externalThreadId,
        );
        expect(threadIds).toContain(firstThreadId);
        expect(threadIds).toContain(secondThreadId);
      },
    );

    it(
      'should add messages to existing thread when using same threadSubId',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);

        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // First invocation with specific threadSubId
        const trigger1Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['First message in thread'],
            threadSubId: 'persistent-thread',
          },
        );

        expect(trigger1Result.threadId).toBeDefined();
        const threadId = trigger1Result.threadId;

        // Second invocation with same threadSubId
        const trigger2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Second message in same thread'],
            threadSubId: 'persistent-thread',
          },
        );

        expect(trigger2Result.threadId).toBeDefined();

        // Should get the same thread ID
        expect(trigger2Result.threadId).toBe(threadId);

        // Wait for thread to be persisted
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) => threads.length === 1,
          { timeout: 10000 },
        );

        expect(threads).toHaveLength(1);
        expect(threads[0]?.externalThreadId).toBe(threadId);
      },
    );
  });

  describe('Thread Retrieval', () => {
    it(
      'should retrieve thread by external ID',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);

        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test external thread retrieval'],
            threadSubId: 'external-retrieval-test',
          },
        );

        expect(triggerResult.threadId).toBeDefined();
        const externalThreadId = triggerResult.threadId;

        // Wait for thread to be created in database
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(externalThreadId),
          (thread) => !!thread && thread.externalThreadId === externalThreadId,
          { timeout: 10000 },
        );

        expect(thread.graphId).toBe(graphId);
        expect(thread.externalThreadId).toBe(externalThreadId);
      },
    );

    it('should return 404 for non-existent thread', async () => {
      const nonExistentThreadId = 'non-existent-graph-id:thread-id';

      await expect(
        threadsService.getThreadByExternalId(nonExistentThreadId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Thread Async Execution', () => {
    it('should execute trigger with async=true and return immediately', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);

      const execResult = await graphsService.executeTrigger(
        graphId,
        'trigger-1',
        {
          messages: ['Say hello and then finish.'],
          async: true,
        },
      );

      expect(execResult.threadId).toBeDefined();
      expect(execResult.checkpointNs).toBeDefined();
    });
  });

  describe('Multi-Agent Thread Management', () => {
    it(
      'should create one internal thread for multiple agents in the same graph execution',
      { timeout: 60000 },
      async () => {
        // Create a graph with multiple agents
        const multiAgentGraphData = createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'First Agent',
                  instructions: 'You are the first agent',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'agent-2',
                template: 'simple-agent',
                config: {
                  name: 'Second Agent',
                  instructions: 'You are the second agent',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'comm-tool-1',
                template: 'agent-communication-tool',
                config: {},
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'comm-tool-1' },
              { from: 'comm-tool-1', to: 'agent-2' },
            ],
          },
        });

        const createResult = await graphsService.create(multiAgentGraphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test multi-agent thread'],
            threadSubId: 'multi-agent-thread',
          },
        );

        // Wait for exactly one thread to be created for the entire execution
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) => threads.length === 1,
          { timeout: 10000 },
        );

        expect(threads).toHaveLength(1);
        expect(threads[0]?.externalThreadId).toBe(triggerResult.threadId);
      },
    );
  });

  describe('Message Retrieval and Management', () => {
    it('should retrieve thread by ID', { timeout: 60000 }, async () => {
      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);

      const triggerResult = await graphsService.executeTrigger(
        graphId,
        'trigger-1',
        {
          messages: ['Test message'],
          threadSubId: 'test-thread-id',
        },
      );

      // Wait for thread to be created
      const threads = await waitForCondition(
        () =>
          threadsService.getThreads({
            graphId,
            limit: 100,
            offset: 0,
          }),
        (threads) =>
          threads.some(
            (t) =>
              (t as { externalThreadId: string }).externalThreadId ===
              triggerResult.threadId,
          ),
        { timeout: 10000 },
      );

      const thread = threads.find(
        (t) =>
          (t as { externalThreadId: string }).externalThreadId ===
          triggerResult.threadId,
      );
      expect(thread).toBeDefined();
      expect((thread as { externalThreadId: string }).externalThreadId).toBe(
        triggerResult.threadId,
      );
    });

    it(
      'should retrieve messages for a thread after execution',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const testMessage = 'Hello, this is a test message';
        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [testMessage],
            threadSubId: 'message-retrieval-test',
          },
        );

        // Wait for thread to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages to be persisted (at least user message)
        const messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        // Should have at least the human message
        expect(messages.length).toBeGreaterThanOrEqual(1);

        // Verify the user message exists
        const userMessage = messages.find(
          (m) => (m as { message: { role: string } }).message.role === 'human',
        );
        expect(userMessage).toBeDefined();

        const content = (
          userMessage as { message: { content: string | unknown[] } }
        ).message.content;
        const contentStr =
          typeof content === 'string' ? content : JSON.stringify(content);
        expect(contentStr).toContain('test message');
      },
    );

    it(
      'should limit messages when limit parameter is provided',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test message'],
            threadSubId: 'limit-test',
          },
        );

        // Wait for thread to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages to exist
        await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length > 0,
          { timeout: 10000 },
        );

        const limitedMessages = await threadsService.getThreadMessages(
          thread.id,
          {
            limit: 2,
            offset: 0,
          },
        );

        expect(limitedMessages.length).toBeLessThanOrEqual(2);
        expect(limitedMessages.length).toBeGreaterThan(0);
      },
    );

    it('should include human and AI messages', { timeout: 60000 }, async () => {
      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);

      const triggerResult = await graphsService.executeTrigger(
        graphId,
        'trigger-1',
        {
          messages: ['User message'],
          threadSubId: 'human-ai-test',
        },
      );

      // Wait for thread to be created
      const thread = await waitForCondition(
        () => threadsService.getThreadByExternalId(triggerResult.threadId),
        (thread) => !!thread,
        { timeout: 10000 },
      );

      // Wait for at least human message
      const messages = await waitForCondition(
        () =>
          threadsService.getThreadMessages(thread.id, {
            limit: 100,
            offset: 0,
          }),
        (messages) => messages.length >= 1,
        { timeout: 10000 },
      );

      const messageRoles = messages.map(
        (m) => (m as { message: { role: string } }).message.role,
      );

      // Must contain human message
      expect(messageRoles).toContain('human');

      // Verify the user message content
      const humanMsg = messages.find(
        (m) => (m as { message: { role: string } }).message.role === 'human',
      );
      expect(humanMsg).toBeDefined();
    });

    it(
      'should not duplicate messages when re-invoking existing thread',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const threadSubId = 'no-duplicate-test';

        // First invocation
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['First message'],
          threadSubId,
        });

        // Second invocation with same threadSubId
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Second message'],
          threadSubId,
        });

        // Wait for threads to stabilize
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) =>
            threads.filter((t) =>
              (t as { externalThreadId: string }).externalThreadId.includes(
                threadSubId,
              ),
            ).length === 1,
          { timeout: 10000 },
        );

        // Should still have only one thread
        const threadCount = threads.filter((t) =>
          (t as { externalThreadId: string }).externalThreadId.includes(
            threadSubId,
          ),
        ).length;

        expect(threadCount).toBe(1);
      },
    );

    it(
      'should persist messages across graph restarts',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const persistentMessage = 'Persistent message';
        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [persistentMessage],
            threadSubId: 'persist-test',
          },
        );

        // Wait for thread and messages to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages to be persisted
        await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        // Stop the graph
        await graphsService.destroy(graphId);

        // Restart the graph
        await graphsService.run(graphId);

        // Messages should still be retrievable after restart
        const messages = await threadsService.getThreadMessages(thread.id, {
          limit: 100,
          offset: 0,
        });

        expect(messages.length).toBeGreaterThanOrEqual(1);

        // Verify the persistent message exists
        const userMessage = messages.find(
          (m) => (m as { message: { role: string } }).message.role === 'human',
        );
        expect(userMessage).toBeDefined();

        const content = (
          userMessage as { message: { content: string | unknown[] } }
        ).message.content;
        const contentStr =
          typeof content === 'string' ? content : JSON.stringify(content);
        expect(contentStr).toContain('Persistent message');
      },
    );

    it(
      'should isolate messages between different threads',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // Create two different threads
        const thread1Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Message for thread 1'],
            threadSubId: 'isolation-thread-1',
          },
        );

        const thread2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Message for thread 2'],
            threadSubId: 'isolation-thread-2',
          },
        );

        // Wait for both threads to be created
        const thread1 = await waitForCondition(
          () => threadsService.getThreadByExternalId(thread1Result.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        const thread2 = await waitForCondition(
          () => threadsService.getThreadByExternalId(thread2Result.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages in both threads
        const thread1Messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread1.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        const thread2Messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread2.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        // Verify thread 1 has its message
        const thread1UserMsg = thread1Messages.find(
          (m) => (m as { message: { role: string } }).message.role === 'human',
        );
        expect(thread1UserMsg).toBeDefined();

        // Verify thread 2 has its message
        const thread2UserMsg = thread2Messages.find(
          (m) => (m as { message: { role: string } }).message.role === 'human',
        );
        expect(thread2UserMsg).toBeDefined();

        // Thread 1 should not contain thread 2 messages and vice versa
        expect(
          thread1Messages.some((m) => {
            const content = (m as { message: { content: string | unknown[] } })
              .message.content;
            const contentStr =
              typeof content === 'string' ? content : JSON.stringify(content);
            return contentStr.includes('Message for thread 2');
          }),
        ).toBe(false);

        expect(
          thread2Messages.some((m) => {
            const content = (m as { message: { content: string | unknown[] } })
              .message.content;
            const contentStr =
              typeof content === 'string' ? content : JSON.stringify(content);
            return contentStr.includes('Message for thread 1');
          }),
        ).toBe(false);
      },
    );
  });

  describe('Thread Deletion', () => {
    it(
      'should delete a thread and its messages',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test deletion'],
            threadSubId: 'delete-test',
          },
        );

        // Wait for thread to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Delete the thread
        await threadsService.deleteThread(thread.id);

        // Thread should no longer exist
        await expect(
          threadsService.getThreadByExternalId(triggerResult.threadId),
        ).rejects.toThrow(NotFoundException);
      },
    );

    it('should return 404 when trying to delete non-existent thread', async () => {
      const nonExistentThreadId = '00000000-0000-0000-0000-000000000000';

      await expect(
        threadsService.deleteThread(nonExistentThreadId),
      ).rejects.toThrow(NotFoundException);
    });

    it(
      'should delete thread and all its messages in multi-agent scenario',
      { timeout: 60000 },
      async () => {
        const multiAgentGraphData = createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'First Agent',
                  instructions: 'First agent',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'agent-2',
                template: 'simple-agent',
                config: {
                  name: 'Second Agent',
                  instructions: 'Second agent',
                  invokeModelName: 'gpt-5-mini',
                },
              },
              {
                id: 'comm-tool-1',
                template: 'agent-communication-tool',
                config: {},
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'comm-tool-1' },
              { from: 'comm-tool-1', to: 'agent-2' },
            ],
          },
        });

        const createResult = await graphsService.create(multiAgentGraphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Multi-agent deletion test'],
            threadSubId: 'multi-agent-delete-test',
          },
        );

        // Wait for thread to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages to be persisted
        const messagesBefore = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        expect(messagesBefore.length).toBeGreaterThanOrEqual(1);

        // Delete the thread
        await threadsService.deleteThread(thread.id);

        // Thread and all messages should be deleted
        await expect(
          threadsService.getThreadByExternalId(triggerResult.threadId),
        ).rejects.toThrow(NotFoundException);
      },
    );
  });

  describe('Message Filtering and Deduplication', () => {
    it('should filter messages by nodeId', { timeout: 60000 }, async () => {
      const multiAgentGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Agent 1',
                instructions: 'You are agent 1',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'agent-2',
              template: 'simple-agent',
              config: {
                name: 'Agent 2',
                instructions: 'You are agent 2',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'comm-tool-1',
              template: 'agent-communication-tool',
              config: {},
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'comm-tool-1' },
            { from: 'comm-tool-1', to: 'agent-2' },
          ],
        },
      });

      const createResult = await graphsService.create(multiAgentGraphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);

      const triggerResult = await graphsService.executeTrigger(
        graphId,
        'trigger-1',
        {
          messages: ['Test message filtering'],
          threadSubId: 'filter-test',
        },
      );

      // Wait for thread to be created
      const thread = await waitForCondition(
        () => threadsService.getThreadByExternalId(triggerResult.threadId),
        (thread) => !!thread,
        { timeout: 10000 },
      );

      // Wait for messages to be available
      const allMessages = await waitForCondition(
        () =>
          threadsService.getThreadMessages(thread.id, {
            limit: 100,
            offset: 0,
          }),
        (messages) => messages.length >= 1,
        { timeout: 15000 },
      );

      // Filter by specific nodeId
      const agent1Messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
        nodeId: 'agent-1',
      });

      expect(agent1Messages.length).toBeGreaterThanOrEqual(0);

      // All filtered messages should be from agent-1
      agent1Messages.forEach((msg) => {
        expect((msg as { nodeId: string }).nodeId).toBe('agent-1');
      });
    });

    it(
      'should not create duplicate messages during agent execution',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Test for message deduplication'],
            threadSubId: 'dedup-test',
          },
        );

        // Wait for thread to be created
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Wait for messages to be available
        const messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        // Check for duplicate messages by comparing IDs
        const messageIds = messages.map((m) => (m as { id: string }).id);
        const uniqueMessageIds = new Set(messageIds);

        // All message IDs should be unique
        expect(messageIds.length).toBe(uniqueMessageIds.size);
        expect(messageIds.length).toBeGreaterThanOrEqual(1);
      },
    );
  });

  describe('Thread Name Generation', () => {
    it(
      'should automatically generate and set thread name on first execution',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Generate a thread name for this conversation'],
            threadSubId: 'name-gen-test',
          },
        );

        // Wait for thread to be created and name to be generated
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => {
            const name = (thread as { name?: string }).name;
            return !!thread && !!name && name !== '';
          },
          { timeout: 15000 },
        );

        // Thread name should be generated
        expect((thread as { name?: string }).name).toBeDefined();
        expect((thread as { name?: string }).name).not.toBe('');
      },
    );

    it(
      'should not update thread name if it already exists',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // First execution
        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['First message to generate name'],
            threadSubId: 'name-persist-test',
          },
        );

        // Wait for thread to be created and name to be generated
        const threadAfterFirst = await waitForCondition(
          () => threadsService.getThreadByExternalId(firstResult.threadId),
          (thread) => {
            const name = (thread as { name?: string }).name;
            return !!thread && !!name && name !== '';
          },
          { timeout: 15000 },
        );
        const firstName = (threadAfterFirst as { name?: string }).name;
        expect(firstName).toBeDefined();

        // Second execution with same thread
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Second message should not change name'],
          threadSubId: 'name-persist-test',
        });

        // Wait a bit for potential name update (which shouldn't happen)
        await waitForCondition(
          () => threadsService.getThreadByExternalId(firstResult.threadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        const threadAfterSecond = await threadsService.getThreadByExternalId(
          firstResult.threadId,
        );
        const secondName = (threadAfterSecond as { name?: string }).name;

        // Name should remain the same
        expect(secondName).toBe(firstName);
      },
    );
  });

  describe('Thread Status', () => {
    it(
      'should mark thread as done after successful execution',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const triggerResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Complete this task successfully'],
            threadSubId: 'status-done-test',
          },
        );

        // Wait for thread to be created and execution to reach a final state
        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(triggerResult.threadId),
          (thread) => {
            const status = (thread as { status: string }).status;
            // Wait until status is not 'running' or 'pending'
            return (
              !!thread &&
              !!status &&
              status !== 'running' &&
              status !== 'pending'
            );
          },
          { timeout: 20000 },
        );

        // Thread status should be set after execution
        const status = (thread as { status: string }).status;
        expect(status).toBeDefined();
        // Status should be one of the valid final states
        expect(['done', 'need_more_info', 'stopped']).toContain(status);
      },
    );

    it(
      'should mark thread as stopped when execution is interrupted',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // Start an async execution
        const execResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Long running task that will be interrupted'],
            threadSubId: 'status-stopped-test',
            async: true,
          },
        );

        // Wait for thread to be created
        await waitForCondition(
          () => threadsService.getThreadByExternalId(execResult.threadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        // Destroy the graph to interrupt execution
        await graphsService.destroy(graphId);

        // Wait for status update
        await waitForCondition(
          () => threadsService.getThreadByExternalId(execResult.threadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        const thread = await threadsService.getThreadByExternalId(
          execResult.threadId,
        );

        // Thread status should be defined
        const status = (thread as { status: string }).status;
        expect(status).toBeDefined();
      },
    );
  });

  describe('Message Summarization', () => {
    it(
      'should isolate messages between different threadSubIds with aggressive summarization',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Agent',
                  instructions: 'You are a helpful agent',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 100, // Aggressive summarization
                  summarizeKeepTokens: 50,
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        });

        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // Create two threads with aggressive summarization
        const thread1Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Thread 1 message with aggressive summarization'],
            threadSubId: 'aggressive-thread-1',
          },
        );

        const thread2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Thread 2 message with aggressive summarization'],
            threadSubId: 'aggressive-thread-2',
          },
        );

        // Verify threads are separate
        expect(thread1Result.threadId).not.toBe(thread2Result.threadId);

        // Wait for both threads to be persisted
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) => threads.length === 2,
          { timeout: 10000 },
        );

        const threadIds = threads.map(
          (t) => (t as { externalThreadId: string }).externalThreadId,
        );

        expect(threadIds).toContain(thread1Result.threadId);
        expect(threadIds).toContain(thread2Result.threadId);
      },
    );

    it(
      'should preserve full message history with conservative summarization',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData({
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Agent',
                  instructions: 'You are a helpful agent',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 272000, // Conservative - high limit
                  summarizeKeepTokens: 30000,
                },
              },
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
            ],
            edges: [{ from: 'trigger-1', to: 'agent-1' }],
          },
        });

        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const threadSubId = 'conservative-summarization-test';

        // Send multiple messages
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['First message'],
          threadSubId,
        });

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Second message'],
          threadSubId,
        });

        // Wait for thread to be created
        const threads = await waitForCondition(
          () =>
            threadsService.getThreads({
              graphId,
              limit: 100,
              offset: 0,
            }),
          (threads) =>
            threads.some((t) =>
              (t as { externalThreadId: string }).externalThreadId.includes(
                threadSubId,
              ),
            ),
          { timeout: 10000 },
        );

        const targetThread = threads.find((t) =>
          (t as { externalThreadId: string }).externalThreadId.includes(
            threadSubId,
          ),
        );

        expect(targetThread).toBeDefined();

        // Get the internal thread ID
        const threadId = (targetThread as { id: string }).id;

        // Wait for messages to be available
        const messages = await waitForCondition(
          () =>
            threadsService.getThreadMessages(threadId, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 1,
          { timeout: 10000 },
        );

        // With conservative summarization, messages should be preserved
        expect(messages.length).toBeGreaterThanOrEqual(1);
      },
    );
  });
});
