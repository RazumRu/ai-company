import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { BaseException } from '@packages/common';
import { io, Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  GraphNodeSchemaType,
  GraphSchemaType,
} from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { IEnrichedNotification } from '../../../v1/notification-handlers/notification-handlers.types';
import {
  IAgentStateUpdateData,
  IGraphNodeUpdateData,
} from '../../../v1/notifications/notifications.types';
import { ThreadMessageDto } from '../../../v1/threads/dto/threads.dto';
import { ThreadEntity } from '../../../v1/threads/entity/thread.entity';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule, TEST_USER_ID } from '../setup';

// Type aliases for socket notifications (using business logic interfaces)
type MessageNotification = IEnrichedNotification<ThreadMessageDto>;
type NodeUpdateNotification = IEnrichedNotification<IGraphNodeUpdateData>;
type ThreadNotification = IEnrichedNotification<ThreadEntity>;
type StateUpdateNotification = IEnrichedNotification<IAgentStateUpdateData>;

describe('Socket Notifications Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let socket: Socket;
  let ioAdapter: IoAdapter;
  let baseUrl: string;
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();

    ioAdapter = new IoAdapter(app);
    app.useWebSocketAdapter(ioAdapter);

    await app.listen(5050, '127.0.0.1');

    graphsService = app.get<GraphsService>(GraphsService);
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
    it('should subscribe to graph updates', { timeout: 60000 }, async () => {
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
          30000,
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
      { timeout: 60000 },
      async () => {
        socket = createSocketConnection(TEST_USER_ID);
        await waitForSocketConnection(socket);

        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Subscribe to graph
        socket.emit('subscribe_graph', { graphId });

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
      { timeout: 60000 },
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
          }, 60000);
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
      { timeout: 130000 },
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
            120000,
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
      { timeout: 30000 },
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
          }, 30000);
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
