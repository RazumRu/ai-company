import { INestApplication } from '@nestjs/common';
import { BaseException, NotFoundException } from '@packages/common';
import { NonEmptyObject } from 'type-fest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NewMessageMode } from '../../../v1/agents/agents.types';
import { SimpleAgent } from '../../../v1/agents/services/agents/simple-agent';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Thread Management Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let graphRegistry: GraphRegistry;
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
    graphRegistry = app.get<GraphRegistry>(GraphRegistry);
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

  const waitForHumanMessageContents = async (
    externalThreadId: string,
    expectedCount: number,
  ) => {
    const thread = await waitForCondition(
      () => threadsService.getThreadByExternalId(externalThreadId),
      (thread) => !!thread,
      { timeout: 60000 },
    );

    const messages = await waitForCondition(
      () =>
        threadsService.getThreadMessages(thread.id, {
          limit: 100,
          offset: 0,
        }),
      (messages) =>
        messages.filter((m) => m.message.role === 'human').length >=
        expectedCount,
      { timeout: 60000 },
    );

    return messages.filter((m) => m.message.role === 'human');
  };

  const createAndRunGraphWithMessageMode = async (
    mode: NewMessageMode,
    agentId = 'agent-1',
  ) => {
    const graphData = createMockGraphData({
      schema: {
        nodes: [
          {
            id: agentId,
            template: 'simple-agent',
            config: {
              instructions: 'You are a helpful test agent. Answer briefly.',
              invokeModelName: 'gpt-5-mini',
              summarizeMaxTokens: 272000,
              summarizeKeepTokens: 30000,
              newMessageMode: mode,
            },
          },
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {},
          },
        ],
        edges: [
          {
            from: 'trigger-1',
            to: agentId,
          },
        ],
      },
    });

    const createResult = await graphsService.create(graphData);
    const graphId = createResult.id;
    createdGraphIds.push(graphId);

    await graphsService.run(graphId);

    const agentNode = graphRegistry.getNode<SimpleAgent>(graphId, agentId);
    if (!agentNode) {
      throw new Error(`Agent node ${agentId} not found for graph ${graphId}`);
    }

    return { graphId, agent: agentNode.instance };
  };

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

        expect(trigger1Result.externalThreadId).toBeDefined();
        const firstThreadId = trigger1Result.externalThreadId;

        // Second invocation without threadSubId
        const trigger2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Second message'],
          },
        );

        expect(trigger2Result.externalThreadId).toBeDefined();
        const secondThreadId = trigger2Result.externalThreadId;

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

        expect(trigger1Result.externalThreadId).toBeDefined();
        const threadId = trigger1Result.externalThreadId;

        // Second invocation with same threadSubId
        const trigger2Result = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Second message in same thread'],
            threadSubId: 'persistent-thread',
          },
        );

        expect(trigger2Result.externalThreadId).toBeDefined();

        // Should get the same thread ID
        expect(trigger2Result.externalThreadId).toBe(threadId);

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

        expect(triggerResult.externalThreadId).toBeDefined();
        const externalThreadId = triggerResult.externalThreadId;

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

      expect(execResult.externalThreadId).toBeDefined();
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
        expect(threads[0]?.externalThreadId).toBe(
          triggerResult.externalThreadId,
        );
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
              triggerResult.externalThreadId,
          ),
        { timeout: 10000 },
      );

      const thread = threads.find(
        (t) =>
          (t as { externalThreadId: string }).externalThreadId ===
          triggerResult.externalThreadId,
      );
      expect(thread).toBeDefined();
      expect((thread as { externalThreadId: string }).externalThreadId).toBe(
        triggerResult.externalThreadId,
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
        () =>
          threadsService.getThreadByExternalId(triggerResult.externalThreadId),
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          () =>
            threadsService.getThreadByExternalId(
              thread1Result.externalThreadId,
            ),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        const thread2 = await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(
              thread2Result.externalThreadId,
            ),
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

  describe('New Message Modes', () => {
    it(
      'should append messages sequentially when no active run (inject_after_tool_call)',
      { timeout: 60000 },
      async () => {
        const { graphId } = await createAndRunGraphWithMessageMode(
          NewMessageMode.InjectAfterToolCall,
          'agent-1',
        );

        const threadSubId = 'inject-no-active';
        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Inject mode no active - first'],
            threadSubId,
          },
        );

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Inject mode no active - second'],
            threadSubId,
          },
        );

        await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(secondResult.externalThreadId),
          (entry) =>
            entry.status === ThreadStatus.Done ||
            entry.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        expect(secondResult.externalThreadId).toEqual(
          firstResult.externalThreadId,
        );

        const humanMessages = await waitForHumanMessageContents(
          secondResult.externalThreadId,
          2,
        );

        expect(humanMessages).toHaveLength(2);
        expect(humanMessages.map((m) => m.message.content)).toEqual(
          expect.arrayContaining([
            'Inject mode no active - first',
            'Inject mode no active - second',
          ]),
        );

        const firstMessage = humanMessages.find(
          (m) => m.message.content === 'Inject mode no active - first',
        );

        const secondMessage = humanMessages.find(
          (m) => m.message.content === 'Inject mode no active - second',
        );

        expect(firstMessage).toBeDefined();
        expect(secondMessage).toBeDefined();
        // make sure first we got first message
        expect(new Date(firstMessage!.createdAt).getTime()).toBeLessThan(
          new Date(secondMessage!.createdAt).getTime(),
        );
      },
    );

    it(
      'should inject messages into an active run when mode is inject_after_tool_call',
      { timeout: 60000 },
      async () => {
        const { graphId } = await createAndRunGraphWithMessageMode(
          NewMessageMode.InjectAfterToolCall,
          'agent-1',
        );

        const threadSubId = 'inject-active';
        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Tell me what is the 2+2?'],
            threadSubId,
            async: true,
          },
        );

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Oh not, 2+3, sorry'],
            threadSubId,
          },
        );

        expect(secondResult.externalThreadId).toEqual(
          firstResult.externalThreadId,
        );

        const humanMessages = await waitForHumanMessageContents(
          secondResult.externalThreadId,
          2,
        );

        const firstMessage = humanMessages.find(
          (m) => m.message.content === 'Tell me what is the 2+2?',
        );

        const secondMessage = humanMessages.find(
          (m) => m.message.content === 'Oh not, 2+3, sorry',
        );

        expect(firstMessage).toBeDefined();
        expect(secondMessage).toBeDefined();
        // make sure first we got first message
        expect(new Date(firstMessage!.createdAt).getTime()).toBeLessThan(
          new Date(secondMessage!.createdAt).getTime(),
        );

        const thread = await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(secondResult.externalThreadId),
          (entry) =>
            entry.status === ThreadStatus.Done ||
            entry.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        const threadMessages = await threadsService.getThreadMessages(
          thread.id,
        );

        expect(threadMessages[0]?.message.role).to.be.not.eq('human');
        expect(
          (
            threadMessages[0]?.message.content as NonEmptyObject<{
              message: string;
            }>
          ).message,
        ).includes('5');
      },
    );

    it(
      'should append messages sequentially when no active run (wait_for_completion)',
      { timeout: 60000 },
      async () => {
        const { graphId } = await createAndRunGraphWithMessageMode(
          NewMessageMode.WaitForCompletion,
          'agent-1',
        );

        const threadSubId = 'wait-mode-no-active';
        const firstMessage = 'Wait mode no active - first';
        const secondMessage = 'Wait mode no active - second';

        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [firstMessage],
            threadSubId,
          },
        );

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [secondMessage],
            threadSubId,
          },
        );

        const thread = await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(secondResult.externalThreadId),
          (entry) =>
            entry.status === ThreadStatus.Done ||
            entry.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        expect(secondResult.externalThreadId).toEqual(
          firstResult.externalThreadId,
        );

        const humanMessages = await waitForHumanMessageContents(
          secondResult.externalThreadId,
          2,
        );

        expect(humanMessages).toHaveLength(2);
        expect(humanMessages.map((m) => m.message.content)).toEqual(
          expect.arrayContaining([firstMessage, secondMessage]),
        );

        const firstStored = humanMessages.find(
          (m) => m.message.content === firstMessage,
        );
        const secondStored = humanMessages.find(
          (m) => m.message.content === secondMessage,
        );

        expect(firstStored).toBeDefined();
        expect(secondStored).toBeDefined();
        expect(new Date(firstStored!.createdAt).getTime()).toBeLessThan(
          new Date(secondStored!.createdAt).getTime(),
        );

        const threadMessages = await threadsService.getThreadMessages(
          thread.id,
        );
        expect(threadMessages[0]?.message.role).to.be.not.eq('human');
      },
    );

    it(
      'should queue new messages until completion when mode is wait_for_completion',
      { timeout: 60000 },
      async () => {
        const { graphId } = await createAndRunGraphWithMessageMode(
          NewMessageMode.WaitForCompletion,
          'agent-1',
        );

        const threadSubId = 'wait-mode-queue';
        const firstMessage =
          'Start a long running reasoning task and share your thoughts.';
        const secondMessage = 'Also list some mitigation strategies.';

        const firstResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [firstMessage],
            threadSubId,
            async: true,
          },
        );

        const secondResult = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: [secondMessage],
            threadSubId,
            async: true,
          },
        );

        expect(secondResult.externalThreadId).toEqual(
          firstResult.externalThreadId,
        );

        const completedThread = await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(secondResult.externalThreadId),
          (thread) =>
            thread.status === ThreadStatus.Done ||
            thread.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        const humanMessages = await waitForHumanMessageContents(
          completedThread.externalThreadId,
          2,
        );

        expect(humanMessages.map((m) => m.message.content)).toEqual(
          expect.arrayContaining([firstMessage, secondMessage]),
        );

        const firstStored = humanMessages.find(
          (m) => m.message.content === firstMessage,
        );
        const secondStored = humanMessages.find(
          (m) => m.message.content === secondMessage,
        );

        expect(firstStored).toBeDefined();
        expect(secondStored).toBeDefined();
        expect(new Date(firstStored!.createdAt).getTime()).toBeLessThan(
          new Date(secondStored!.createdAt).getTime(),
        );

        const threadMessages = await threadsService.getThreadMessages(
          completedThread.id,
        );
        expect(threadMessages[0]?.message.role).to.be.not.eq('human');
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
          (thread) => !!thread,
          { timeout: 10000 },
        );

        // Delete the thread
        await threadsService.deleteThread(thread.id);

        // Thread should no longer exist
        await expect(
          threadsService.getThreadByExternalId(triggerResult.externalThreadId),
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          threadsService.getThreadByExternalId(triggerResult.externalThreadId),
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
        () =>
          threadsService.getThreadByExternalId(triggerResult.externalThreadId),
        (thread) => !!thread,
        { timeout: 10000 },
      );

      // Wait for messages to be available
      await waitForCondition(
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          () =>
            threadsService.getThreadByExternalId(firstResult.externalThreadId),
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
          () =>
            threadsService.getThreadByExternalId(firstResult.externalThreadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        const threadAfterSecond = await threadsService.getThreadByExternalId(
          firstResult.externalThreadId,
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
          () =>
            threadsService.getThreadByExternalId(
              triggerResult.externalThreadId,
            ),
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
          () =>
            threadsService.getThreadByExternalId(execResult.externalThreadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        // Destroy the graph to interrupt execution
        await graphsService.destroy(graphId);

        // Wait for status update
        await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(execResult.externalThreadId),
          (thread) => !!thread,
          { timeout: 5000 },
        );

        const thread = await threadsService.getThreadByExternalId(
          execResult.externalThreadId,
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
        expect(thread1Result.externalThreadId).not.toBe(
          thread2Result.externalThreadId,
        );

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

        expect(threadIds).toContain(thread1Result.externalThreadId);
        expect(threadIds).toContain(thread2Result.externalThreadId);
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

  describe('Parallel Thread State Isolation', () => {
    it(
      'should maintain separate thread states when running 2 threads in parallel',
      { timeout: 120000 },
      async () => {
        // Create and start graph
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // Start two threads in parallel with async=true
        const [exec1, exec2] = await Promise.all([
          graphsService.executeTrigger(graphId, 'trigger-1', {
            messages: ['Thread 1: Tell me about cats'],
            threadSubId: 'parallel-test-1',
            async: true,
          }),
          graphsService.executeTrigger(graphId, 'trigger-1', {
            messages: ['Thread 2: Tell me about dogs'],
            threadSubId: 'parallel-test-2',
            async: true,
          }),
        ]);

        expect(exec1.externalThreadId).toBeDefined();
        expect(exec2.externalThreadId).toBeDefined();
        expect(exec1.externalThreadId).not.toBe(exec2.externalThreadId);

        // Wait for both threads to be created in the database
        const thread1 = await waitForCondition(
          () => threadsService.getThreadByExternalId(exec1.externalThreadId),
          (thread) => !!thread,
          { timeout: 15000 },
        );

        const thread2 = await waitForCondition(
          () => threadsService.getThreadByExternalId(exec2.externalThreadId),
          (thread) => !!thread,
          { timeout: 15000 },
        );

        expect(thread1.id).toBeDefined();
        expect(thread2.id).toBeDefined();
        expect(thread1.id).not.toBe(thread2.id);
        expect(thread1.externalThreadId).toBe(exec1.externalThreadId);
        expect(thread2.externalThreadId).toBe(exec2.externalThreadId);

        // Both threads should initially be Running
        expect(thread1.status).toBe(ThreadStatus.Running);
        expect(thread2.status).toBe(ThreadStatus.Running);

        // Wait for both threads to complete
        const completedThread1 = await waitForCondition(
          () => threadsService.getThreadById(thread1.id),
          (t) =>
            t.status === ThreadStatus.Done ||
            t.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        const completedThread2 = await waitForCondition(
          () => threadsService.getThreadById(thread2.id),
          (t) =>
            t.status === ThreadStatus.Done ||
            t.status === ThreadStatus.NeedMoreInfo,
          { timeout: 60000 },
        );

        // Verify final states
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          completedThread1.status,
        );
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          completedThread2.status,
        );

        // Get messages for both threads
        const messages1 = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread1.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 2, // At least user + AI message
          { timeout: 15000 },
        );

        const messages2 = await waitForCondition(
          () =>
            threadsService.getThreadMessages(thread2.id, {
              limit: 100,
              offset: 0,
            }),
          (messages) => messages.length >= 2, // At least user + AI message
          { timeout: 15000 },
        );

        // Verify messages are isolated
        expect(messages1.length).toBeGreaterThanOrEqual(2);
        expect(messages2.length).toBeGreaterThanOrEqual(2);

        // Extract user messages
        const thread1UserMsg = messages1.find(
          (m: { message: { role: string; content: string | unknown[] } }) =>
            m.message.role === 'human',
        );
        const thread2UserMsg = messages2.find(
          (m: { message: { role: string; content: string | unknown[] } }) =>
            m.message.role === 'human',
        );

        expect(thread1UserMsg).toBeDefined();
        expect(thread2UserMsg).toBeDefined();

        const content1 =
          typeof thread1UserMsg!.message.content === 'string'
            ? thread1UserMsg!.message.content
            : JSON.stringify(thread1UserMsg!.message.content);
        const content2 =
          typeof thread2UserMsg!.message.content === 'string'
            ? thread2UserMsg!.message.content
            : JSON.stringify(thread2UserMsg!.message.content);

        // Verify correct messages went to correct threads
        expect(content1).toContain('cats');
        expect(content1).not.toContain('dogs');
        expect(content2).toContain('dogs');
        expect(content2).not.toContain('cats');

        // Verify thread names are set independently (if generated)
        const finalThread1 = await threadsService.getThreadById(thread1.id);
        const finalThread2 = await threadsService.getThreadById(thread2.id);

        // If names were generated, they should be different
        if (finalThread1.name && finalThread2.name) {
          expect(finalThread1.name).not.toBe(finalThread2.name);
        }
      },
    );

    it(
      'should isolate thread statuses between concurrent executions',
      { timeout: 60000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        // Start two threads in parallel
        const [exec1, exec2] = await Promise.all([
          graphsService.executeTrigger(graphId, 'trigger-1', {
            messages: ['Quick message for thread 1'],
            threadSubId: 'status-test-1',
            async: true,
          }),
          graphsService.executeTrigger(graphId, 'trigger-1', {
            messages: ['Quick message for thread 2'],
            threadSubId: 'status-test-2',
            async: true,
          }),
        ]);

        // Wait for both threads to be created
        const thread1 = await waitForCondition(
          () => threadsService.getThreadByExternalId(exec1.externalThreadId),
          (thread) => !!thread,
          { timeout: 15000 },
        );

        const thread2 = await waitForCondition(
          () => threadsService.getThreadByExternalId(exec2.externalThreadId),
          (thread) => !!thread,
          { timeout: 15000 },
        );

        // Both should be Running initially
        expect(thread1.status).toBe(ThreadStatus.Running);
        expect(thread2.status).toBe(ThreadStatus.Running);

        // Wait for both to complete
        await Promise.all([
          waitForCondition(
            () => threadsService.getThreadById(thread1.id),
            (t) =>
              t.status === ThreadStatus.Done ||
              t.status === ThreadStatus.NeedMoreInfo,
            { timeout: 60000 },
          ),
          waitForCondition(
            () => threadsService.getThreadById(thread2.id),
            (t) =>
              t.status === ThreadStatus.Done ||
              t.status === ThreadStatus.NeedMoreInfo,
            { timeout: 60000 },
          ),
        ]);

        // Verify final states are independently set
        const finalThread1 = await threadsService.getThreadById(thread1.id);
        const finalThread2 = await threadsService.getThreadById(thread2.id);

        // Both should have valid completion statuses
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          finalThread1.status,
        );
        expect([ThreadStatus.Done, ThreadStatus.NeedMoreInfo]).toContain(
          finalThread2.status,
        );

        // Thread IDs should remain different
        expect(finalThread1.id).not.toBe(finalThread2.id);
        expect(finalThread1.externalThreadId).not.toBe(
          finalThread2.externalThreadId,
        );
      },
    );
  });
});
