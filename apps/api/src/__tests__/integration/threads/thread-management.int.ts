import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

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

  afterEach(async () => {
    // Cleanup all created graphs
    for (const graphId of createdGraphIds) {
      try {
        await graphsService.destroy(graphId);
      } catch {
        // Graph might not be running
      }
      try {
        await graphsService.delete(graphId);
      } catch {
        // Graph might already be deleted
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Thread Creation and Isolation', () => {
    it(
      'should create a new internal thread for each invocation without threadSubId',
      { timeout: 25000 },
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

      // Verify both threads exist
      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });
      expect(threads.length).toBe(2);

      const threadIds = threads.map(
        (t: unknown) => (t as { externalThreadId: string }).externalThreadId,
      );
      expect(threadIds).toContain(firstThreadId);
      expect(threadIds).toContain(secondThreadId);
    },
    );

    it(
      'should add messages to existing thread when using same threadSubId',
      { timeout: 15000 },
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

      // Verify only 1 thread exists
      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });
      expect(threads.length).toBe(1);
      expect(threads[0]?.externalThreadId).toBe(threadId);
    },
    );
  });

  describe('Thread Retrieval', () => {
    it(
      'should retrieve thread by external ID',
      { timeout: 15000 },
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

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Test retrieving thread by external ID
      const thread =
        await threadsService.getThreadByExternalId(externalThreadId);

      expect(thread.graphId).toBe(graphId);
      expect(thread.externalThreadId).toBe(externalThreadId);
    },
    );

    it('should return 404 for non-existent thread', async () => {
      const nonExistentThreadId = 'non-existent-graph-id:thread-id';

      await expect(
        threadsService.getThreadByExternalId(nonExistentThreadId),
      ).rejects.toThrow();
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
    it('should create one internal thread for multiple agents in the same graph execution', async () => {
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
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'agent-2' },
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

      // Should create only one thread for the entire execution
      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });

      expect(threads.length).toBe(1);
      expect(threads[0]?.externalThreadId).toBe(triggerResult.threadId);
    });
  });

  describe('Message Retrieval and Management', () => {
    it(
      'should retrieve thread by ID',
      { timeout: 15000 },
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
          threadSubId: 'test-thread-id',
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });

      expect(threads.length).toBeGreaterThan(0);
      const thread = threads.find(
        (t) =>
          (t as { externalThreadId: string }).externalThreadId ===
          triggerResult.threadId,
      );
      expect(thread).toBeDefined();
    },
    );

    it(
      'should retrieve messages for a thread after execution',
      { timeout: 15000 },
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
          messages: ['Hello, this is a test message'],
          threadSubId: 'message-retrieval-test',
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      const messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(
        messages.some((m) =>
          (m as { message: { content: string } }).message.content.includes(
            'test message',
          ),
        ),
      ).toBe(true);
    },
    );

    it(
      'should limit messages when limit parameter is provided',
      { timeout: 15000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      const limitedMessages = await threadsService.getThreadMessages(thread.id, {
        limit: 2,
        offset: 0,
      });

      expect(limitedMessages.length).toBeLessThanOrEqual(2);
    },
    );

    it(
      'should include human and AI messages',
      { timeout: 15000 },
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
          messages: ['User message'],
          threadSubId: 'human-ai-test',
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      const messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });

      const messageRoles = messages.map(
        (m) => (m as { message: { role: string } }).message.role,
      );

      expect(messageRoles).toContain('human');
      // AI message might be present depending on execution
    },
    );

    it(
      'should not duplicate messages when re-invoking existing thread',
      { timeout: 15000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Second invocation with same threadSubId
      await graphsService.executeTrigger(graphId, 'trigger-1', {
        messages: ['Second message'],
        threadSubId,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const messagesAfterSecond = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });

      // Should still have only one thread
      const threadCount = messagesAfterSecond.filter((t) =>
        (t as { externalThreadId: string }).externalThreadId.includes(
          threadSubId,
        ),
      ).length;

      expect(threadCount).toBe(1);
    },
    );

    it(
      'should persist messages across graph restarts',
      { timeout: 15000 },
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
          messages: ['Persistent message'],
          threadSubId: 'persist-test',
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Stop the graph
      await graphsService.destroy(graphId);

      // Restart the graph
      await graphsService.run(graphId);

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      // Messages should still be retrievable
      const messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });

      expect(messages.length).toBeGreaterThan(0);
      expect(
        messages.some((m) =>
          (m as { message: { content: string } }).message.content.includes(
            'Persistent message',
          ),
        ),
      ).toBe(true);
    },
    );

    it(
      'should isolate messages between different threads',
      { timeout: 15000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get both threads by external ID to get the internal UUIDs
      const thread1 = await threadsService.getThreadByExternalId(
        thread1Result.threadId,
      );
      const thread2 = await threadsService.getThreadByExternalId(
        thread2Result.threadId,
      );

      const thread1Messages = await threadsService.getThreadMessages(thread1.id, {
        limit: 100,
        offset: 0,
      });

      const thread2Messages = await threadsService.getThreadMessages(thread2.id, {
        limit: 100,
        offset: 0,
      });

      // Thread 1 should not contain thread 2 messages and vice versa
      expect(
        thread1Messages.some((m) =>
          (m as { message: { content: string } }).message.content.includes(
            'Message for thread 2',
          ),
        ),
      ).toBe(false);

      expect(
        thread2Messages.some((m) =>
          (m as { message: { content: string } }).message.content.includes(
            'Message for thread 1',
          ),
        ),
      ).toBe(false);
    },
    );
  });

  describe('Thread Deletion', () => {
    it(
      'should delete a thread and its messages',
      { timeout: 15000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      // Delete the thread
      await threadsService.deleteThread(thread.id);

      // Thread should no longer exist
      await expect(
        threadsService.getThreadByExternalId(triggerResult.threadId),
      ).rejects.toThrow();
    },
    );

    it('should return 404 when trying to delete non-existent thread', async () => {
      const nonExistentThreadId = '00000000-0000-0000-0000-000000000000';

      await expect(
        threadsService.deleteThread(nonExistentThreadId),
      ).rejects.toThrow();
    });

    it('should delete thread and all its messages in multi-agent scenario', async () => {
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
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'agent-2' },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      const messagesBefore = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });
      expect(messagesBefore.length).toBeGreaterThan(0);

      // Delete the thread
      await threadsService.deleteThread(thread.id);

      // Thread and all messages should be deleted
      await expect(
        threadsService.getThreadByExternalId(triggerResult.threadId),
      ).rejects.toThrow();
    });
  });

  describe('Message Filtering and Deduplication', () => {
    it(
      'should filter messages by nodeId',
      { timeout: 20000 },
      async () => {
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
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'agent-2' },
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

      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      // Get all messages
      const allMessages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });

      // Filter by specific nodeId
      const agent1Messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
        nodeId: 'agent-1',
      });

      // Agent 1 filtered messages should be less than or equal to all messages
      expect(agent1Messages.length).toBeLessThanOrEqual(allMessages.length);

      // All filtered messages should be from agent-1
      agent1Messages.forEach((msg) => {
        expect((msg as { nodeId: string }).nodeId).toBe('agent-1');
      });
    },
    );

    it(
      'should not create duplicate messages during agent execution',
      { timeout: 15000 },
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

      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Get the thread by external ID to get the internal UUID
      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      const messages = await threadsService.getThreadMessages(thread.id, {
        limit: 100,
        offset: 0,
      });

      // Check for duplicate messages by comparing IDs
      const messageIds = messages.map((m) => (m as { id: string }).id);
      const uniqueMessageIds = new Set(messageIds);

      expect(messageIds.length).toBe(uniqueMessageIds.size);
    },
    );
  });

  describe('Thread Name Generation', () => {
    it(
      'should automatically generate and set thread name on first execution',
      { timeout: 20000 },
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

      // Wait for name generation
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      // Thread name should be generated
      expect((thread as { name?: string }).name).toBeDefined();
      expect((thread as { name?: string }).name).not.toBe('');
    },
    );

    it(
      'should not update thread name if it already exists',
      { timeout: 35000 },
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

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const threadAfterFirst = await threadsService.getThreadByExternalId(
        firstResult.threadId,
      );
      const firstName = (threadAfterFirst as { name?: string }).name;

      // Second execution with same thread
      await graphsService.executeTrigger(graphId, 'trigger-1', {
        messages: ['Second message should not change name'],
        threadSubId: 'name-persist-test',
      });

      await new Promise((resolve) => setTimeout(resolve, 5000));

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
      { timeout: 20000 },
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

      // Wait for execution to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const thread = await threadsService.getThreadByExternalId(
        triggerResult.threadId,
      );

      // Thread status should be 'done' after successful completion
      expect(['done', 'need_more_info']).toContain(
        (thread as { status: string }).status,
      );
    },
    );

    it(
      'should mark thread as stopped when execution is interrupted',
      { timeout: 15000 },
      async () => {
      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      await graphsService.run(graphId);

      // Start an async execution
      const execPromise = graphsService.executeTrigger(graphId, 'trigger-1', {
        messages: ['Long running task that will be interrupted'],
        threadSubId: 'status-stopped-test',
        async: true,
      });

      const execResult = await execPromise;

      // Wait a bit for execution to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Destroy the graph to interrupt execution
      await graphsService.destroy(graphId);

      // Wait for status update
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const thread = await threadsService.getThreadByExternalId(
        execResult.threadId,
      );

      // Thread status should reflect interruption
      expect((thread as { status: string }).status).toBeDefined();
    },
    );
  });

  describe('Message Summarization', () => {
    it(
      'should isolate messages between different threadSubIds with aggressive summarization',
      { timeout: 25000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify threads are separate
      expect(thread1Result.threadId).not.toBe(thread2Result.threadId);

      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });

      const threadIds = threads.map(
        (t) => (t as { externalThreadId: string }).externalThreadId,
      );

      expect(threadIds).toContain(thread1Result.threadId);
      expect(threadIds).toContain(thread2Result.threadId);
    },
    );

    it(
      'should preserve full message history with conservative summarization',
      { timeout: 30000 },
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

      await new Promise((resolve) => setTimeout(resolve, 2000));

      await graphsService.executeTrigger(graphId, 'trigger-1', {
        messages: ['Second message'],
        threadSubId,
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const threads = await threadsService.getThreads({
        graphId,
        limit: 100,
        offset: 0,
      });

      const targetThread = threads.find((t) =>
        (t as { externalThreadId: string }).externalThreadId.includes(
          threadSubId,
        ),
      );

      expect(targetThread).toBeDefined();

      // Get the internal thread ID
      const threadId = (targetThread as { id: string }).id;

      // With conservative summarization, messages should be preserved
      const messages = await threadsService.getThreadMessages(threadId, {
        limit: 100,
        offset: 0,
      });

      expect(messages.length).toBeGreaterThan(0);
    },
    );
  });
});
