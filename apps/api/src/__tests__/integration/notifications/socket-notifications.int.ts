import { AIMessageChunk } from '@langchain/core/messages';
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { BaseException } from '@packages/common';
import { io, Socket } from 'socket.io-client';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ReasoningEffort } from '../../../v1/agents/agents.types';
import { buildReasoningMessage } from '../../../v1/agents/agents.utils';
import {
  SimpleAgent,
  SimpleAgentSchemaType,
} from '../../../v1/agents/services/agents/simple-agent';
import { GraphThreadState } from '../../../v1/agents/services/graph-thread-state';
import {
  CreateGraphDto,
  ReasoningMessageDto,
} from '../../../v1/graphs/dto/graphs.dto';
import {
  GraphNodeSchemaType,
  GraphNodeStatus,
  GraphSchemaType,
} from '../../../v1/graphs/graphs.types';
import { GraphRegistry } from '../../../v1/graphs/services/graph-registry';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { MessageTransformerService } from '../../../v1/graphs/services/message-transformer.service';
import { IEnrichedNotification } from '../../../v1/notification-handlers/notification-handlers.types';
import {
  IAgentStateUpdateData,
  IGraphNodeUpdateData,
  Notification,
  NotificationEvent,
} from '../../../v1/notifications/notifications.types';
import { NotificationsService } from '../../../v1/notifications/services/notifications.service';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import {
  ThreadDto,
  ThreadMessageDto,
} from '../../../v1/threads/dto/threads.dto';
import { ThreadEntity } from '../../../v1/threads/entity/thread.entity';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import {
  createMockGraphData,
  waitForCondition,
} from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

// Type aliases for socket notifications (using business logic interfaces)
type MessageNotification = IEnrichedNotification<ThreadMessageDto>;
type NodeUpdateNotification = IEnrichedNotification<IGraphNodeUpdateData>;
type ThreadNotification = IEnrichedNotification<ThreadEntity>;
type StateUpdateNotification = IEnrichedNotification<IAgentStateUpdateData>;

describe('Socket Notifications Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let graphRegistry: GraphRegistry;
  let notificationsService: NotificationsService;
  let threadsService: ThreadsService;
  let messagesDao: MessagesDao;
  let messageTransformer: MessageTransformerService;
  let socket: Socket;
  let ioAdapter: IoAdapter;
  let baseUrl: string;
  const createdGraphIds: string[] = [];
  const STOP_TRIGGER_NODE_ID = 'trigger-1';
  const STOP_AGENT_NODE_ID = 'agent-1';
  const STOP_SHELL_NODE_ID = 'shell-1';
  const STOP_RUNTIME_NODE_ID = 'runtime-1';
  const COMMAND_AGENT_INSTRUCTIONS =
    'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, describe what happened. If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

  const createCommandGraphData = (): CreateGraphDto => ({
    name: `Command Graph ${Date.now()}`,
    description: 'Graph with shell runtime for destroy-stop scenarios',
    temporary: true,
    schema: {
      nodes: [
        {
          id: STOP_TRIGGER_NODE_ID,
          template: 'manual-trigger',
          config: {},
        },
        {
          id: STOP_AGENT_NODE_ID,
          template: 'simple-agent',
          config: {
            instructions: COMMAND_AGENT_INSTRUCTIONS,
            name: 'Test Agent',
            description: 'Test agent description',
            summarizeMaxTokens: 272000,
            summarizeKeepTokens: 30000,
            invokeModelName: 'gpt-5-mini',
            invokeModelReasoningEffort: ReasoningEffort.None,
            enforceToolUsage: true,
            maxIterations: 50,
          } satisfies SimpleAgentSchemaType,
        },
        {
          id: STOP_SHELL_NODE_ID,
          template: 'shell-tool',
          config: {},
        },
        {
          id: STOP_RUNTIME_NODE_ID,
          template: 'docker-runtime',
          config: {
            runtimeType: 'Docker',
            image: 'python:3.11-slim',
            env: {},
          },
        },
      ],
      edges: [
        { from: STOP_TRIGGER_NODE_ID, to: STOP_AGENT_NODE_ID },
        { from: STOP_AGENT_NODE_ID, to: STOP_SHELL_NODE_ID },
        { from: STOP_SHELL_NODE_ID, to: STOP_RUNTIME_NODE_ID },
      ],
    },
  });

  beforeAll(async () => {
    app = await createTestModule();

    ioAdapter = new IoAdapter(app);
    app.useWebSocketAdapter(ioAdapter);

    await app.listen(5050, '127.0.0.1');

    graphsService = app.get<GraphsService>(GraphsService);
    graphRegistry = app.get<GraphRegistry>(GraphRegistry);
    notificationsService = app.get<NotificationsService>(NotificationsService);
    threadsService = app.get<ThreadsService>(ThreadsService);
    messagesDao = app.get<MessagesDao>(MessagesDao);
    messageTransformer = app.get<MessageTransformerService>(
      MessageTransformerService,
    );
    baseUrl = 'http://localhost:5050';
  });

  afterEach(async () => {
    // Disconnect socket
    if (socket && socket.connected) {
      socket.disconnect();
    }

    // Cleanup all created graphs
    for (const graphId of createdGraphIds) {
      try {
        await graphsService.destroy(graphId);
      } catch (error: unknown) {
        // Only ignore expected "not running" errors - re-throw others
        if (
          error instanceof BaseException &&
          error.errorCode !== 'GRAPH_NOT_RUNNING' &&
          error.errorCode !== 'GRAPH_NOT_FOUND'
        ) {
          console.error(`Unexpected error destroying graph ${graphId}:`, error);
          throw error;
        }
      }
      try {
        await graphsService.delete(graphId);
      } catch (error: unknown) {
        // Only ignore expected "not found" errors - re-throw others
        if (
          error instanceof BaseException &&
          error.errorCode !== 'GRAPH_NOT_FOUND'
        ) {
          console.error(`Unexpected error deleting graph ${graphId}:`, error);
          throw error;
        }
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const createSocketConnection = (userId: string): Socket => {
    return io(baseUrl, {
      auth: {
        'x-dev-jwt-sub': userId,
      },
      transports: ['websocket'],
      reconnection: false,
    });
  };

  const waitForSocketConnection = (socket: Socket): Promise<void> => {
    return new Promise((resolve, reject) => {
      socket.on('socket_connected', () => resolve());
      socket.on('server_error', (error) => reject(error));
      setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    });
  };

  const extractPendingMessageContent = (
    message: unknown,
  ): string | undefined => {
    if (!message || typeof message !== 'object') {
      return undefined;
    }

    if (typeof (message as { content?: unknown }).content === 'string') {
      return (message as { content?: string }).content;
    }

    const lcKwargs = (
      message as {
        lc_kwargs?: { content?: unknown };
        kwargs?: { content?: unknown };
      }
    ).lc_kwargs;

    if (typeof lcKwargs?.content === 'string') {
      return lcKwargs.content;
    }

    const kwargs = (message as { kwargs?: { content?: unknown } }).kwargs;
    if (typeof kwargs?.content === 'string') {
      return kwargs.content;
    }

    return undefined;
  };

  describe('Connection', () => {
    it('should connect successfully with valid token', async () => {
      socket = createSocketConnection(TEST_USER_ID);
      await waitForSocketConnection(socket);

      expect(socket.connected).toBe(true);
    });

    it('should reject connection without token', async () => {
      socket = createSocketConnection('');

      await expect(waitForSocketConnection(socket)).rejects.toThrow();
    });
  });

  describe('Graph Subscription', () => {
    it('should subscribe to graph updates', { timeout: 90_000 }, async () => {
      socket = createSocketConnection(TEST_USER_ID);
      await waitForSocketConnection(socket);

      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // Subscribe to graph
      socket.emit('subscribe_graph', { graphId });

      // Set up listener for graph update events
      const notificationPromise = new Promise((resolve, reject) => {
        socket.once('graph.update', (notification) => {
          expect(notification).toHaveProperty('graphId', graphId);
          expect(notification).toHaveProperty('type', 'graph.update');
          resolve(notification);
        });

        socket.once('server_error', (error) => reject(error));
        setTimeout(
          () => reject(new Error('Timeout waiting for notification')),
          60_000,
        );
      });

      // Trigger a graph action that will emit notifications
      await graphsService.run(graphId);

      await notificationPromise;
    });

    it('should receive error when subscribing to non-existent graph', async () => {
      socket = createSocketConnection(TEST_USER_ID);
      await waitForSocketConnection(socket);

      const fakeGraphId = '00000000-0000-0000-0000-000000000000';

      const errorPromise = new Promise((resolve, reject) => {
        socket.once('server_error', (error) => {
          expect(error).toHaveProperty('message');
          expect(error.message).toContain('Graph not found');
          resolve(error);
        });

        setTimeout(() => reject(new Error('Timeout waiting for error')), 5000);
      });

      socket.emit('subscribe_graph', { graphId: fakeGraphId });

      await errorPromise;
    });

    it('should unsubscribe from graph updates', async () => {
      socket = createSocketConnection(TEST_USER_ID);
      await waitForSocketConnection(socket);

      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // Subscribe
      socket.emit('subscribe_graph', { graphId });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Unsubscribe
      socket.emit('unsubscribe_graph', { graphId });

      // Should not receive errors
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(socket.connected).toBe(true);
    });
  });

  describe('Message Notifications', () => {
    it(
      'should receive message notifications during graph execution',
      { timeout: 90_000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Subscribe to graph
        socket.emit('subscribe_graph', { graphId });
        await new Promise((resolve) => setTimeout(resolve, 500));

        const receivedMessages: unknown[] = [];

        // Set up listener for message events
        const messagePromise = new Promise((resolve, reject) => {
          socket.on('agent.message', (notification) => {
            receivedMessages.push(notification);

            expect(notification).toHaveProperty('graphId', graphId);
            expect(notification).toHaveProperty('type', 'agent.message');
            expect(notification.data).toHaveProperty('message');
            expect(notification.data.message).toHaveProperty('content');
            expect(notification.data.message).toHaveProperty('role');

            // Once we have at least 2 messages (user + AI response), we're done
            if (receivedMessages.length >= 2) {
              resolve(receivedMessages);
            }
          });

          socket.once('server_error', (error) => reject(error));
        });

        // Run the graph
        await graphsService.run(graphId);

        // Execute trigger
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Hello, this is a test message'],
          async: true,
        });

        await messagePromise;

        // Verify we got expected messages (at least 2)
        expect(receivedMessages.length).toBeGreaterThanOrEqual(2);
        const typedMessages = receivedMessages as MessageNotification[];

        // Verify messages have expected structure
        typedMessages.forEach((msg) => {
          expect(msg.graphId).toBe(graphId);
          expect(msg.type).toBe('agent.message');
          expect(msg.data.message).toBeDefined();
          expect(msg.data.message.content).toBeDefined(); // Content can be empty string
          expect(['human', 'ai']).toContain(msg.data.message.role);
        });
      },
    );

    it(
      'should not receive duplicate message notifications',
      { timeout: 60000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        socket.emit('subscribe_graph', { graphId });

        const messageNotifications: unknown[] = [];

        socket.on('agent.message', (notification) => {
          messageNotifications.push(notification);
        });

        await graphsService.run(graphId);

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Test message for duplicate check'],
        });

        // Wait for messages to arrive
        await new Promise((resolve) => setTimeout(resolve, 30000));

        // Check for duplicates by comparing message content and threadId
        const typedNotifications =
          messageNotifications as MessageNotification[];
        const messageKeys = typedNotifications.map(
          (n) =>
            `${n.threadId}:${n.data.message.role}:${n.data.message.content}`,
        );

        const uniqueKeys = new Set(messageKeys);

        // Assert no duplicates
        expect(messageKeys.length).toBe(uniqueKeys.size);
      },
    );

    it(
      'emits a single stop message notification when graph execution is stopped',
      { timeout: 120_000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createCommandGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        socket.emit('subscribe_graph', { graphId });
        await new Promise((resolve) => setTimeout(resolve, 500));

        const stopNotifications: MessageNotification[] = [];

        socket.on('agent.message', (notification: unknown) => {
          const typedNotification = notification as MessageNotification;
          const messageContent = typedNotification?.data?.message?.content;

          if (
            typeof messageContent === 'string' &&
            messageContent.includes('Graph execution was stopped')
          ) {
            stopNotifications.push(typedNotification);
          }
        });

        await graphsService.run(graphId);

        const execution = await graphsService.executeTrigger(
          graphId,
          STOP_TRIGGER_NODE_ID,
          {
            messages: ['Run this command: sleep 100 && echo "interrupt me"'],
            async: true,
          },
        );

        await waitForCondition(
          () =>
            threadsService.getThreadByExternalId(execution.externalThreadId),
          (thread) => thread.status === ThreadStatus.Running,
          { timeout: 60000, interval: 1000 },
        );

        await graphsService.destroy(graphId);

        await waitForCondition(
          async () => stopNotifications,
          (notifications) => notifications.length >= 1,
          { timeout: 60000, interval: 500 },
        );

        // Give time for any duplicate notifications to surface
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const stopMessageNotifications = stopNotifications.filter(
          (notification) =>
            typeof notification.data.message.content === 'string' &&
            notification.data.message.content.includes(
              'Graph execution was stopped',
            ),
        );

        const stopKeys = stopMessageNotifications.map(
          (notification) =>
            `${notification.threadId}:${notification.data.message.content}`,
        );
        const uniqueStopKeys = new Set(stopKeys);

        expect(stopMessageNotifications).toHaveLength(1);
        expect(uniqueStopKeys.size).toBe(1);
        expect(stopMessageNotifications[0]?.data.message.content).toContain(
          'Graph execution was stopped',
        );
      },
    );

    it(
      'should receive multiple message notifications during graph execution',
      { timeout: 60000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        socket.emit('subscribe_graph', { graphId });

        const receivedMessages: unknown[] = [];

        // Set up listener for message events
        const messagePromise = new Promise((resolve, reject) => {
          socket.on('agent.message', (notification) => {
            receivedMessages.push(notification);

            // Verify each message has the correct structure
            expect(notification).toHaveProperty('graphId', graphId);
            expect(notification).toHaveProperty('type', 'agent.message');
            expect(notification.data).toHaveProperty('message');
            expect(notification.data.message).toHaveProperty('content');
            expect(notification.data.message).toHaveProperty('role');

            // Once we have at least 2 messages (user + AI response), we're done
            if (receivedMessages.length >= 2) {
              resolve(undefined);
            }
          });

          socket.once('server_error', (error) => reject(error));

          // Timeout after 20 seconds
          setTimeout(() => {
            // We should have at least received some messages
            if (receivedMessages.length > 0) {
              resolve(undefined);
            } else {
              reject(new Error('Timeout: No message notifications received'));
            }
          }, 30000);
        });

        await graphsService.run(graphId);

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Hello, how are you?'],
          async: true,
        });

        await messagePromise;
      },
    );
  });

  describe('Graph Revision Notifications', () => {
    it(
      'should receive revision lifecycle notifications when revision is applied',
      { timeout: 120_000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        const currentVersion = createResult.version;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        socket.emit('subscribe_graph', { graphId });
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const revisionEvents: unknown[] = [];
        const expectedEvents = [
          'graph.revision.create',
          'graph.revision.applying',
          'graph.revision.applied',
        ];

        const eventsPromise = new Promise((resolve, reject) => {
          const seenEvents = new Set<string>();

          expectedEvents.forEach((eventType) => {
            socket.on(eventType, (payload) => {
              if (payload.graphId === graphId) {
                revisionEvents.push({ type: eventType, payload });
                seenEvents.add(eventType);

                if (
                  expectedEvents.every((expected) => seenEvents.has(expected))
                ) {
                  resolve(revisionEvents);
                }
              }
            });
          });

          socket.once('server_error', (error) => reject(error));
          setTimeout(() => {
            if (revisionEvents.length > 0) {
              resolve(revisionEvents);
            } else {
              reject(new Error('Timeout waiting for revision events'));
            }
          }, 90_000);
        });

        // Update schema to trigger revision
        const updatedSchema: GraphSchemaType = {
          ...createResult.schema,
          nodes: createResult.schema.nodes.map((node: GraphNodeSchemaType) =>
            node.id === 'agent-1'
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    instructions: 'Socket test applied revision instructions',
                  },
                }
              : node,
          ),
        };

        await graphsService.update(graphId, {
          schema: updatedSchema,
          currentVersion,
        });

        const events = await eventsPromise;
        const eventTypes = (events as { type: string }[]).map((e) => e.type);
        const uniqueEventTypes = Array.from(new Set(eventTypes));

        // Verify we receive the meaningful lifecycle events
        // Note: 'applying' state is extremely transient and may be missed in fast tests
        expect(uniqueEventTypes).toContain('graph.revision.create');
        expect(uniqueEventTypes).toContain('graph.revision.applied');

        // The applying event is optional since it's transient (microseconds)
        // and socket notifications have inherent race conditions
      },
    );

    it(
      'should receive multiple revision notifications',
      { timeout: 180_000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        const baseSchema: GraphSchemaType = createResult.schema;
        let currentVersion = createResult.version;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        socket.emit('subscribe_graph', { graphId });
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Track meaningful events: create and applied for each revision
        // Note: 'applying' is too transient to reliably test via socket notifications
        const requiredEvents = [
          'graph.revision.create',
          'graph.revision.applied',
          'graph.revision.create',
          'graph.revision.applied',
        ];

        const eventsPromise = new Promise((resolve, reject) => {
          const events: unknown[] = [];
          const eventTypes: string[] = [];

          const eventListeners = [
            'graph.revision.create',
            'graph.revision.applying',
            'graph.revision.applied',
          ];

          eventListeners.forEach((type) => {
            socket.on(type, (payload) => {
              if (payload.graphId === graphId) {
                events.push({ type, payload });
                eventTypes.push(type);

                // Check if we have all required events (ignoring transient 'applying')
                const requiredReceived = requiredEvents.every(
                  (required) =>
                    eventTypes.filter((t) => t === required).length >=
                    requiredEvents.filter((r) => r === required).length,
                );

                if (requiredReceived) {
                  resolve(events);
                }
              }
            });
          });

          socket.once('server_error', reject);
          setTimeout(
            () =>
              reject(
                new Error(
                  `Timeout waiting for revision events. Received: ${events.length}, Types: ${eventTypes.join(', ')}`,
                ),
              ),
            150_000,
          );
        });

        // First update
        const firstSchema: GraphSchemaType = {
          ...baseSchema,
          nodes: baseSchema.nodes.map((node: GraphNodeSchemaType) =>
            node.id === 'agent-1'
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    instructions: 'First socket revision',
                  },
                }
              : node,
          ),
        };

        const _firstUpdateResult = await graphsService.update(graphId, {
          schema: firstSchema,
          currentVersion,
        });

        // Wait for first revision to be applied
        await new Promise((resolve) => setTimeout(resolve, 8000));

        // Fetch the graph again to get the actual current version
        const updatedGraph = await graphsService.findById(graphId);
        currentVersion = updatedGraph.version;
        const secondSchema: GraphSchemaType = {
          ...baseSchema,
          nodes: baseSchema.nodes.map((node) =>
            node.id === 'agent-1'
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    instructions: 'Second socket revision',
                  },
                }
              : node,
          ),
        };

        await graphsService.update(graphId, {
          schema: secondSchema,
          currentVersion,
        });

        await eventsPromise;
      },
    );
  });

  describe('Node Status Notifications', () => {
    it(
      'should receive node status updates during graph execution',
      { timeout: 90_000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        socket.emit('subscribe_graph', { graphId });

        const nodeEvents: unknown[] = [];
        const statusesSeen = new Set<string>();

        const waitForNodeUpdates = new Promise<void>((resolve, reject) => {
          socket.on('graph.node.update', (notification) => {
            if (notification.graphId === graphId) {
              nodeEvents.push(notification);

              if (notification.data?.status) {
                statusesSeen.add(notification.data.status);
              }

              if (statusesSeen.has('running') && statusesSeen.has('idle')) {
                resolve();
              }
            }
          });

          socket.once('server_error', (error) => reject(error));
          setTimeout(() => {
            if (nodeEvents.length > 0) {
              resolve();
            } else {
              reject(
                new Error('Timeout waiting for node update notifications'),
              );
            }
          }, 60_000);
        });

        await graphsService.run(graphId);

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Test message for node status'],
          async: true,
        });

        await waitForNodeUpdates;

        const typedNodeEvents = nodeEvents as NodeUpdateNotification[];
        const runningEvents = typedNodeEvents.filter(
          (e) => e.data.status === 'running',
        );
        const idleEvents = typedNodeEvents.filter(
          (e) => e.data.status === 'idle',
        );

        // Verify we got both state transitions
        expect(runningEvents.length).toBeGreaterThanOrEqual(1);
        expect(idleEvents.length).toBeGreaterThanOrEqual(1);

        // Verify event structure
        expect(runningEvents[0]!.type).toBe('graph.node.update');
        expect(runningEvents[0]!.graphId).toBeTruthy();
        expect(runningEvents[0]!.data.status).toBe('running');
      },
    );

    it(
      'should include pending message metadata in node update notifications',
      { timeout: 60000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        socket.emit('subscribe_graph', { graphId });

        await graphsService.run(graphId);

        const threadSubId = 'socket-pending-metadata';
        const firstExecution = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Initial socket request'],
            threadSubId,
            async: true,
          },
        );
        const threadId = firstExecution.externalThreadId;

        await waitForCondition(
          () =>
            graphsService.getCompiledNodes(graphId, {
              threadId,
            }),
          (snapshots) =>
            snapshots.some(
              (node) => node.id === 'agent-1' && node.status === 'running',
            ),
          { timeout: 120_000, interval: 1_000 },
        );

        const metadataNotificationPromise = new Promise<NodeUpdateNotification>(
          (resolve, reject) => {
            function handleMetadata(notification: NodeUpdateNotification) {
              const metadata = notification.data?.additionalNodeMetadata as
                | { pendingMessages?: unknown[] }
                | undefined;

              if (
                notification.graphId === graphId &&
                notification.nodeId === 'agent-1' &&
                Array.isArray(metadata?.pendingMessages) &&
                metadata.pendingMessages.length > 0
              ) {
                clearTimeout(timeout);
                socket.off('graph.node.update', handleMetadata);
                resolve(notification);
              }
            }

            const timeout = setTimeout(() => {
              socket.off('graph.node.update', handleMetadata);
              reject(new Error('Timeout waiting for metadata update'));
            }, 30000);

            socket.on('graph.node.update', handleMetadata);
          },
        );

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Follow-up to enqueue pending message'],
          threadSubId,
          async: true,
        });

        const metadataNotification = await metadataNotificationPromise;
        const metadata = metadataNotification.data.additionalNodeMetadata as
          | { pendingMessages?: { content?: string }[] }
          | undefined;

        expect(metadata?.pendingMessages).toBeDefined();

        const pendingMessageContent = extractPendingMessageContent(
          metadata?.pendingMessages?.[0],
        );

        expect(pendingMessageContent).toBe(
          'Follow-up to enqueue pending message',
        );
      },
    );

    it(
      'should receive notification when pending messages are processed and removed',
      { timeout: 60000 },
      async () => {
        const graph = await graphsService.create(createMockGraphData());
        const graphId = graph.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const socket = createSocketConnection(TEST_USER_ID);
        await new Promise<void>((resolve) =>
          socket.once('connect', () => resolve()),
        );

        socket.emit('subscribe_graph', { graphId });

        const threadSubId = 'pending-removal-thread';

        // Start first execution
        const firstExecution = await graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Start task'],
            threadSubId,
            async: true,
          },
        );

        const threadId = firstExecution.externalThreadId;

        // Wait for agent to start running
        await waitForCondition(
          () => graphsService.getCompiledNodes(graphId, { threadId }),
          (snapshots) =>
            snapshots.some(
              (node) =>
                node.id === 'agent-1' &&
                node.status === GraphNodeStatus.Running,
            ),
          { timeout: 120_000, interval: 1_000 },
        );

        // Send follow-up to create pending messages
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Follow-up message'],
          threadSubId,
          async: true,
        });

        // Wait for pending messages to appear in metadata
        const hasPendingNotification = new Promise<NodeUpdateNotification>(
          (resolve, reject) => {
            function handleMetadata(notification: NodeUpdateNotification) {
              const metadata = notification.data?.additionalNodeMetadata as
                | { pendingMessages?: unknown[] }
                | undefined;

              if (
                notification.graphId === graphId &&
                notification.nodeId === 'agent-1' &&
                Array.isArray(metadata?.pendingMessages) &&
                metadata.pendingMessages.length > 0
              ) {
                clearTimeout(timeout);
                socket.off('graph.node.update', handleMetadata);
                resolve(notification);
              }
            }

            const timeout = setTimeout(() => {
              socket.off('graph.node.update', handleMetadata);
              reject(new Error('Timeout waiting for pending messages'));
            }, 30000);

            socket.on('graph.node.update', handleMetadata);
          },
        );

        await hasPendingNotification;

        // Now wait for pending messages to be cleared (processed and removed)
        const pendingClearedNotification = new Promise<NodeUpdateNotification>(
          (resolve, reject) => {
            function handleMetadata(notification: NodeUpdateNotification) {
              const metadata = notification.data?.additionalNodeMetadata as
                | { pendingMessages?: unknown[] }
                | undefined;

              if (
                notification.graphId === graphId &&
                notification.nodeId === 'agent-1' &&
                Array.isArray(metadata?.pendingMessages) &&
                metadata.pendingMessages.length === 0
              ) {
                clearTimeout(timeout);
                socket.off('graph.node.update', handleMetadata);
                resolve(notification);
              }
            }

            const timeout = setTimeout(() => {
              socket.off('graph.node.update', handleMetadata);
              reject(
                new Error('Timeout waiting for pending messages to be cleared'),
              );
            }, 30000);

            socket.on('graph.node.update', handleMetadata);
          },
        );

        const clearedNotification = await pendingClearedNotification;

        // Verify the notification contains empty pending messages array
        const clearedMetadata = clearedNotification.data
          .additionalNodeMetadata as
          | { pendingMessages?: unknown[] }
          | undefined;

        expect(clearedMetadata?.pendingMessages).toBeDefined();
        expect(clearedMetadata?.pendingMessages).toEqual([]);

        socket.disconnect();
      },
    );

    it(
      'should receive sequential notifications as pending messages are added and removed',
      { timeout: 90000 },
      async () => {
        const graph = await graphsService.create(createMockGraphData());
        const graphId = graph.id;
        createdGraphIds.push(graphId);

        await graphsService.run(graphId);

        const socket = createSocketConnection(TEST_USER_ID);
        await new Promise<void>((resolve) =>
          socket.once('connect', () => resolve()),
        );

        socket.emit('subscribe_graph', { graphId });

        const threadSubId = 'sequential-pending-thread';
        const metadataUpdates: {
          pendingCount: number;
          timestamp: number;
        }[] = [];

        // Track all metadata updates
        socket.on(
          'graph.node.update',
          (notification: NodeUpdateNotification) => {
            const metadata = notification.data?.additionalNodeMetadata as
              | { pendingMessages?: unknown[] }
              | undefined;

            if (
              notification.graphId === graphId &&
              notification.nodeId === 'agent-1' &&
              Array.isArray(metadata?.pendingMessages)
            ) {
              metadataUpdates.push({
                pendingCount: metadata.pendingMessages.length,
                timestamp: Date.now(),
              });
            }
          },
        );

        // Start first execution
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Start task'],
          threadSubId,
          async: true,
        });

        const threadId = `${graphId}:${threadSubId}`;

        // Wait for running status
        await waitForCondition(
          () => graphsService.getCompiledNodes(graphId, { threadId }),
          (snapshots) =>
            snapshots.some(
              (node) =>
                node.id === 'agent-1' &&
                node.status === GraphNodeStatus.Running,
            ),
          { timeout: 120_000, interval: 1_000 },
        );

        // Send multiple follow-ups
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Follow-up 1'],
          threadSubId,
          async: true,
        });

        // Wait a bit for the first pending to register
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Follow-up 2'],
          threadSubId,
          async: true,
        });

        // Wait for execution to complete (pending messages cleared)
        await waitForCondition(
          () => graphsService.getCompiledNodes(graphId, { threadId }),
          (snapshots) =>
            snapshots.some(
              (node) =>
                node.id === 'agent-1' &&
                (node.status === GraphNodeStatus.Idle ||
                  node.status === GraphNodeStatus.Stopped),
            ),
          { timeout: 60_000, interval: 1_000 },
        );

        // Give time for final notifications
        await new Promise((resolve) => setTimeout(resolve, 2000));

        socket.disconnect();

        // Verify we received notifications with different pending counts
        expect(metadataUpdates.length).toBeGreaterThan(0);

        // Should have notifications with pending messages
        const withPending = metadataUpdates.filter((u) => u.pendingCount > 0);
        expect(withPending.length).toBeGreaterThan(0);

        // Should have notification(s) with cleared pending messages
        const withoutPending = metadataUpdates.filter(
          (u) => u.pendingCount === 0,
        );
        expect(withoutPending.length).toBeGreaterThan(0);

        // Verify chronological order (at least one increase followed by decrease)
        const hasClearingSequence = metadataUpdates.some((update, index) => {
          if (index === 0) return false;
          const prev = metadataUpdates[index - 1];
          if (!prev) {
            return false;
          }
          return prev.pendingCount > 0 && update.pendingCount === 0;
        });

        expect(hasClearingSequence).toBe(true);
      },
    );
  });

  describe('Reasoning Metadata Notifications', () => {
    it(
      'should emit reasoning metadata updates and clear them when reasoning state resets',
      { timeout: 90000 },
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
            messages: ['Start reasoning metadata test'],
            threadSubId: 'reasoning-metadata-thread',
            async: true,
          },
        );

        const threadId = triggerResult.externalThreadId;
        expect(threadId).toBeDefined();

        const persistedThread = await waitForCondition(
          () =>
            threadsService
              .getThreadByExternalId(threadId)
              .catch(() => undefined),
          (thread): thread is ThreadDto => !!thread,
          { timeout: 60000, interval: 250 },
        );

        if (!persistedThread) {
          throw new Error('Thread was not persisted');
        }

        await waitForCondition(
          () =>
            graphsService.getCompiledNodes(graphId, {
              threadId,
            }),
          (snapshots) =>
            snapshots.some(
              (node) =>
                node.id === 'agent-1' &&
                node.status === GraphNodeStatus.Running,
            ),
          { timeout: 120_000, interval: 1_000 },
        );

        const agentNode = graphRegistry.getNode<SimpleAgent>(
          graphId,
          'agent-1',
        );
        if (!agentNode) {
          throw new Error('Agent node agent-1 not found');
        }

        const agentInstance = agentNode.instance;
        const agentInternals = agentInstance as unknown as {
          handleReasoningChunk?: (tid: string, chunk: AIMessageChunk) => void;
          clearReasoningState?: (tid: string) => void;
          graphThreadState?: GraphThreadState;
        };

        const graphThreadStateMaybe = await waitForCondition(
          () => Promise.resolve(agentInternals.graphThreadState),
          (state) => !!state,
          { timeout: 10000, interval: 100 },
        );
        const graphThreadState = graphThreadStateMaybe!;

        const handleReasoningChunk =
          agentInternals.handleReasoningChunk?.bind(agentInstance);

        if (!handleReasoningChunk) {
          throw new Error('handleReasoningChunk is not available on agent');
        }

        const reasoningChunk = {
          id: 'chunk-integration',
          content: '',
          contentBlocks: [
            {
              type: 'reasoning' as const,
              reasoning: 'integration reasoning step',
            },
          ],
          response_metadata: {},
        } as AIMessageChunk;

        const emitSpy = vi.spyOn(notificationsService, 'emit');
        let processedCallIndex = 0;
        const waitForNotification = async (
          predicate: (event: Notification) => boolean,
        ): Promise<Notification> => {
          const timeoutAt = Date.now() + 10000;
          while (Date.now() < timeoutAt) {
            for (
              let i = processedCallIndex;
              i < emitSpy.mock.calls.length;
              i++
            ) {
              const [event] = emitSpy.mock.calls[i] as [Notification];
              if (predicate(event)) {
                processedCallIndex = i + 1;
                return event;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error('Timeout waiting for notification');
        };

        try {
          handleReasoningChunk(threadId, reasoningChunk);

          const reasoningNotification = await waitForNotification(
            (event) =>
              event.type === NotificationEvent.GraphNodeUpdate &&
              event.graphId === graphId &&
              event.nodeId === 'agent-1' &&
              !!(
                event.data as {
                  additionalNodeMetadata?: Record<string, { id: string }>;
                }
              )?.additionalNodeMetadata?.reasoningChunks,
          );

          const reasoningMetadata =
            (
              reasoningNotification.data as {
                additionalNodeMetadata?: {
                  reasoningChunks?: Record<
                    string,
                    { id: string; content: string }
                  >;
                };
              }
            )?.additionalNodeMetadata ?? {};

          const reasoningChunks =
            reasoningMetadata.reasoningChunks ??
            ({} as Record<string, { id: string; content: string }>);
          const reasoningEntry = reasoningChunks['reasoning:chunk-integration'];
          expect(reasoningEntry).toBeDefined();
          expect(reasoningEntry?.id).toBe('reasoning:chunk-integration');
          expect(reasoningEntry?.content).toBe('integration reasoning step');

          const stateEntry = graphThreadState
            .getByThread(threadId)
            .reasoningChunks.get('reasoning:chunk-integration');
          expect(stateEntry?.id).toBe('reasoning:chunk-integration');

          const clearReasoningState =
            agentInternals.clearReasoningState?.bind(agentInstance);

          if (!clearReasoningState) {
            throw new Error('clearReasoningState is not available on agent');
          }

          clearReasoningState(threadId);

          const clearedNotification = await waitForNotification((event) => {
            if (
              event.type !== NotificationEvent.GraphNodeUpdate ||
              event.graphId !== graphId ||
              event.nodeId !== 'agent-1'
            ) {
              return false;
            }

            const metadata = (
              event.data as {
                additionalNodeMetadata?: Record<string, { id: string }>;
              }
            )?.additionalNodeMetadata;

            return (
              !!metadata &&
              (!metadata.reasoningChunks ||
                Object.keys(metadata.reasoningChunks).length === 0)
            );
          });

          const clearedMetadata =
            (
              clearedNotification.data as {
                additionalNodeMetadata?: {
                  reasoningChunks?: Record<
                    string,
                    { id: string; content: string }
                  >;
                };
              }
            )?.additionalNodeMetadata ?? {};

          expect(clearedMetadata.reasoningChunks).toEqual({});

          const finalStateCount =
            graphThreadState.getByThread(threadId).reasoningChunks.size;
          expect(finalStateCount).toBe(0);

          const reasoningMessageDto = messageTransformer.transformMessageToDto(
            buildReasoningMessage(
              'integration reasoning step',
              'chunk-integration',
            ),
          );

          await messagesDao.create({
            threadId: persistedThread.id,
            externalThreadId: threadId,
            nodeId: 'agent-1',
            message: reasoningMessageDto,
          });

          const storedMessages = await threadsService.getThreadMessages(
            persistedThread.id,
          );

          const storedReasoning = storedMessages.find(
            (msg) =>
              msg.message.role === 'reasoning' &&
              (msg.message as ReasoningMessageDto).id ===
                'reasoning:chunk-integration',
          ) as
            | (ThreadMessageDto & { message: ReasoningMessageDto })
            | undefined;

          expect(storedReasoning).toBeDefined();
          expect(storedReasoning?.message.id).toBe(
            'reasoning:chunk-integration',
          );
        } finally {
          emitSpy.mockRestore();
        }
      },
    );
  });

  describe('Thread Notifications', () => {
    it(
      'should receive thread.create notification when thread is created',
      { timeout: 40000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        const threadCreateEvents: unknown[] = [];

        socket.on('thread.create', (notification) => {
          threadCreateEvents.push(notification);
        });

        socket.emit('subscribe_graph', { graphId });
        await new Promise((resolve) => setTimeout(resolve, 500));

        await graphsService.run(graphId);

        const waitForThreadCreate = new Promise((resolve, reject) => {
          const checkInterval = setInterval(() => {
            if (threadCreateEvents.length > 0) {
              clearInterval(checkInterval);
              resolve(threadCreateEvents[0]);
            }
          }, 500);

          setTimeout(() => {
            clearInterval(checkInterval);
            if (threadCreateEvents.length === 0) {
              reject(
                new Error('Timeout: No thread.create notification received'),
              );
            }
          }, 30000);
        });

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Test message for thread creation'],
        });

        await waitForThreadCreate;

        // Verify thread create events with proper typing
        expect(threadCreateEvents.length).toBeGreaterThanOrEqual(1);
        const typedEvent = threadCreateEvents[0] as ThreadNotification;
        expect(typedEvent.type).toBe('thread.create');
        expect(typedEvent.graphId).toBe(graphId);
        expect(typedEvent.threadId).toMatch(/^[0-9a-f-]+:[0-9a-f-]+$/);
      },
    );

    it(
      'should receive socket notifications for thread state updates',
      { timeout: 40000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Listen for agent state update events
        const stateUpdateEvents: unknown[] = [];
        socket.on('agent.state.update', (data: unknown) => {
          stateUpdateEvents.push(data);
        });

        // Subscribe to graph updates BEFORE running the graph
        socket.emit('subscribe_graph', { graphId });

        // Small wait to ensure subscription is processed
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Set up promise to wait for title update notification
        const waitForTitleUpdate = new Promise((resolve, reject) => {
          const checkForTitleUpdate = () => {
            const titleUpdateEvent = (
              stateUpdateEvents as {
                data?: { generatedTitle?: string };
                type?: string;
                graphId?: string;
              }[]
            ).find((event) => event.data && event.data.generatedTitle);

            if (titleUpdateEvent) {
              expect(titleUpdateEvent.type).toBe('agent.state.update');
              expect(titleUpdateEvent.graphId).toBe(graphId);
              expect(titleUpdateEvent.data!.generatedTitle).toBeDefined();
              expect(titleUpdateEvent.data!.generatedTitle).not.toBe('');
              resolve(undefined);
            }
          };

          // Check periodically for title update
          const intervalId = setInterval(() => {
            checkForTitleUpdate();
          }, 1000);

          // Timeout after 30 seconds
          setTimeout(() => {
            clearInterval(intervalId);
            if (stateUpdateEvents.length === 0) {
              reject(
                new Error(
                  'Timeout: No agent state update notifications received',
                ),
              );
            } else {
              reject(
                new Error(
                  `Timeout: Received ${stateUpdateEvents.length} events but none with generatedTitle`,
                ),
              );
            }
          }, 30000);
        });

        // Run the graph, then execute trigger, then wait for notification
        await graphsService.run(graphId);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Execute trigger
        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Test message for socket notifications'],
          threadSubId: 'socket-test-thread',
        });

        // Wait for the title update notification
        await waitForTitleUpdate;

        // Verify we received expected state updates
        expect(stateUpdateEvents.length).toBeGreaterThanOrEqual(1);
        const typedEvents = stateUpdateEvents as StateUpdateNotification[];
        const titleUpdateEvent = typedEvents.find((e) => e.data.generatedTitle);
        expect(titleUpdateEvent).toBeDefined();
        expect(titleUpdateEvent!.data.generatedTitle).toBeTruthy();
        expect(titleUpdateEvent!.graphId).toBe(graphId);
      },
    );
  });

  describe('Multiple Clients', () => {
    it(
      'should allow multiple connections from the same user',
      { timeout: 15000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        // Add delay before creating second connection to avoid race conditions
        await new Promise((resolve) => setTimeout(resolve, 100));

        const secondSocket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(secondSocket);

        expect(socket.connected).toBe(true);
        expect(secondSocket.connected).toBe(true);
        expect(socket.id).not.toBe(secondSocket.id);

        secondSocket.disconnect();
      },
    );

    it(
      'should broadcast to all user connections',
      { timeout: 30000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        // Add delay before creating second connection to avoid race conditions
        await new Promise((resolve) => setTimeout(resolve, 100));

        const secondSocket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(secondSocket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Set up listeners on both sockets
        const firstSocketEvent = new Promise((resolve, reject) => {
          socket.once('graph.update', (notification) => {
            expect(notification).toHaveProperty('graphId', graphId);
            resolve(notification);
          });
          setTimeout(() => reject(new Error('First socket timeout')), 10000);
        });

        const secondSocketEvent = new Promise((resolve, reject) => {
          secondSocket.once('graph.update', (notification) => {
            expect(notification).toHaveProperty('graphId', graphId);
            resolve(notification);
          });
          setTimeout(() => reject(new Error('Second socket timeout')), 10000);
        });

        // Subscribe both sockets
        socket.emit('subscribe_graph', { graphId });
        secondSocket.emit('subscribe_graph', { graphId });

        // Trigger notification
        await graphsService.run(graphId);

        // Both sockets should receive the notification
        const events = await Promise.all([firstSocketEvent, secondSocketEvent]);
        expect(events.length).toBe(2);
        expect((events[0] as { graphId: string }).graphId).toBe(
          (events[1] as { graphId: string }).graphId,
        );

        secondSocket.disconnect();
      },
    );

    it(
      'should not receive duplicate notifications with multiple socket connections',
      { timeout: 30000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        // Add delay before creating second connection to avoid race conditions
        await new Promise((resolve) => setTimeout(resolve, 100));

        const secondSocket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(secondSocket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        const socket1Messages: { content: string; threadId: string }[] = [];
        const socket2Messages: { content: string; threadId: string }[] = [];

        // Set up message listeners on both sockets
        socket.on('agent.message', (notification) => {
          socket1Messages.push({
            content: notification.data.message.content,
            threadId: notification.threadId,
          });
        });

        secondSocket.on('agent.message', (notification) => {
          socket2Messages.push({
            content: notification.data.message.content,
            threadId: notification.threadId,
          });
        });

        // Subscribe both sockets to the graph
        socket.emit('subscribe_graph', { graphId });
        secondSocket.emit('subscribe_graph', { graphId });

        await new Promise((resolve) => setTimeout(resolve, 500));

        await graphsService.run(graphId);

        await graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Test message for multi-socket duplicate check'],
        });

        // Wait for messages to arrive
        await new Promise((resolve) => setTimeout(resolve, 10000));

        // Both sockets should receive messages - expect at least user + assistant
        expect(socket1Messages.length).toBeGreaterThanOrEqual(2);
        expect(socket2Messages.length).toBeGreaterThanOrEqual(2);

        // Both sockets should receive the same messages (broadcast)
        expect(socket1Messages.length).toBe(socket2Messages.length);

        // Check for duplicates within each socket
        const socket1Keys = socket1Messages.map(
          (m) => `${m.threadId}:${m.content}`,
        );
        const socket2Keys = socket2Messages.map(
          (m) => `${m.threadId}:${m.content}`,
        );

        const socket1Unique = new Set(socket1Keys);
        const socket2Unique = new Set(socket2Keys);

        expect(socket1Keys.length).toBe(socket1Unique.size);
        expect(socket2Keys.length).toBe(socket2Unique.size);

        secondSocket.disconnect();
      },
    );
  });
});
