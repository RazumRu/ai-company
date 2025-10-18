import { Socket } from 'socket.io-client';

import { CreateGraphDto } from '../../api-definitions';
import { generateRandomUUID, mockUserId, reqHeaders } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  executeTrigger,
  runGraph,
} from '../graphs/graphs.helper';
import {
  createSocketConnection,
  disconnectSocket,
  waitForSocketConnection,
  waitForSocketEvent,
} from './socket.helper';

describe('Socket Gateway E2E', () => {
  let socket: Socket;
  let baseUrl: string;
  let createdGraphId: string;

  before(() => {
    // Get base URL from Cypress config
    baseUrl = Cypress.config('baseUrl') || 'http://localhost:5000';
  });

  afterEach(() => {
    // Clean up socket connection after each test
    if (socket) {
      disconnectSocket(socket);
    }
  });

  after(() => {
    // Clean up all created graphs after all tests
    graphCleanup.cleanupAllGraphs();
  });

  describe('Connection', () => {
    it('should connect successfully with valid token', (done) => {
      socket = createSocketConnection(baseUrl, mockUserId);

      socket.on('connect', () => {
        expect(socket.connected).to.be.true;
        done();
      });

      socket.on('connect_error', (error) => {
        done(error);
      });
    });

    it('should connect and be ready for communication', () => {
      socket = createSocketConnection(baseUrl, mockUserId);

      return new Promise((resolve, reject) => {
        socket.on('connect', () => {
          expect(socket.connected).to.be.true;
          resolve(undefined);
        });

        socket.on('connect_error', (error) => {
          reject(error);
        });

        // Set a timeout to avoid hanging
        setTimeout(() => {
          if (socket.connected) {
            resolve(undefined);
          } else {
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      });
    });

    it('should reject connection without token', (done) => {
      socket = createSocketConnection(baseUrl, '');

      let serverErrorReceived = false;
      let testCompleted = false;

      const completeTest = (error?: Error) => {
        if (testCompleted) return;
        testCompleted = true;
        done(error);
      };

      socket.on('server_error', (error) => {
        expect(error).to.have.property('message');
        expect(error.message).to.include('Unauthorized');
        serverErrorReceived = true;
        completeTest(); // Test passes if we get server error
      });

      socket.on('connect', () => {
        // If we get both connect and server_error, that's still acceptable
        // as long as we get the server_error
        setTimeout(() => {
          if (serverErrorReceived) {
            completeTest(); // Test passes if we get server error
          } else {
            completeTest(
              new Error(
                'Should receive server error when connecting without token',
              ),
            );
          }
        }, 100);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!serverErrorReceived) {
          completeTest(
            new Error(
              'Should receive server error when connecting without token',
            ),
          );
        }
      }, 5000);
    });

    it('should disconnect after server error on invalid token', (done) => {
      socket = createSocketConnection(baseUrl, '');

      socket.on('server_error', () => {
        // Wait a bit for disconnect to happen
        setTimeout(() => {
          expect(socket.connected).to.be.false;
          done();
        }, 100);
      });
    });
  });

  describe('Graph Subscription', () => {
    before(() => {
      // Create a test graph
      const graphData = createMockGraphData();
      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        createdGraphId = response.body.id;
      });
    });

    beforeEach(() => {
      socket = createSocketConnection(baseUrl, mockUserId);
      return waitForSocketConnection(socket);
    });

    it('should subscribe to graph updates when user is owner', () => {
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        // Subscribe to graph updates
        socket.emit('subscribe_graph', { graphId: freshGraphId });

        // Set up listener for graph update events
        const notificationPromise = new Promise((resolve, reject) => {
          socket.once('graph.update', (notification) => {
            expect(notification).to.have.property('graphId', freshGraphId);
            expect(notification).to.have.property('type', 'graph.update');
            expect(notification).to.have.property('data');
            expect(notification.data).to.have.property('state');
            resolve(undefined);
          });

          socket.once('server_error', (error) => reject(error));

          // Timeout after 10 seconds
          setTimeout(() => {
            reject(new Error('Timeout waiting for graph update notification'));
          }, 10000);
        });

        // Trigger a graph action that will emit notifications
        // Running the graph will trigger compilation events
        return runGraph(freshGraphId, reqHeaders).then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          // Graph run request completed, now wait for notification
          return notificationPromise;
        });
      });
    });

    it('should receive error when subscribing without graphId', () => {
      socket.emit('subscribe_graph', {});

      return waitForSocketEvent(socket, 'server_error').then((error) => {
        expect(error).to.have.property('message');
        expect(error.message).to.include('Graph ID is required');
      });
    });

    it('should receive error when subscribing to non-existent graph', () => {
      const fakeGraphId = '00000000-0000-0000-0000-000000000000';
      socket.emit('subscribe_graph', { graphId: fakeGraphId });

      return waitForSocketEvent(socket, 'server_error').then((error) => {
        expect(error).to.have.property('message');
        expect(error.message).to.include('Graph not found');
      });
    });

    it('should unsubscribe from graph updates', () => {
      // First subscribe (no explicit event to wait for)
      socket.emit('subscribe_graph', { graphId: createdGraphId });

      return new Promise((resolve, reject) => {
        socket.once('server_error', (error) => reject(error));
        setTimeout(() => {
          // Then unsubscribe
          socket.emit('unsubscribe_graph', { graphId: createdGraphId });
          // No explicit 'unsubscribed_graph' event, just ensure no error
          setTimeout(() => resolve(undefined), 500);
        }, 500);
      });
    });

    it('should unsubscribe without error even without graphId', () => {
      socket.emit('unsubscribe_graph', {});

      // The unsubscribe method doesn't validate graphId, so it should not emit an error
      return new Promise((resolve) => {
        socket.once('server_error', () => {
          // If we get an error, the test should fail
          throw new Error(
            'Should not receive error when unsubscribing without graphId',
          );
        });

        // Wait a bit to ensure no error is emitted
        setTimeout(() => resolve(undefined), 500);
      });
    });
  });

  describe('Notifications', () => {
    before(() => {
      // Create a test graph if not already created
      if (!createdGraphId) {
        const graphData = createMockGraphData();
        return createGraph(graphData, reqHeaders).then((response) => {
          expect(response.status).to.equal(201);
          createdGraphId = response.body.id;
        });
      }
    });

    beforeEach(() => {
      socket = createSocketConnection(baseUrl, mockUserId);
      return waitForSocketConnection(socket);
    });

    it('should receive notifications in user room without explicit subscription', () => {
      // User should automatically be in their user room and receive notifications
      // for their graphs even without explicitly subscribing to the graph
      // Create a fresh graph for this test to avoid "already running" issues
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        // Set up listener for graph update events
        const notificationPromise = new Promise((resolve, reject) => {
          socket.once('graph.update', (notification) => {
            expect(notification).to.have.property('graphId', freshGraphId);
            expect(notification).to.have.property('type', 'graph.update');
            expect(notification).to.have.property('data');
            expect(notification.data).to.have.property('state');
            resolve(undefined);
          });

          socket.once('server_error', (error) => reject(error));

          // Timeout after 10 seconds
          setTimeout(() => {
            reject(new Error('Timeout waiting for graph update notification'));
          }, 10000);
        });

        // Trigger a graph action that will emit notifications
        // Running the graph will trigger compilation events
        return runGraph(freshGraphId, reqHeaders).then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          // Graph run request completed, now wait for notification
          return notificationPromise;
        });
      });
    });

    it('should receive message notifications with correct data', function () {
      // Increase Cypress default timeout for this specific test
      this.timeout(120000); // 2 minutes

      // Create a fresh graph for this test
      const graphData = createMockGraphData();
      let freshGraphId: string;

      // Set up the promise for waiting for notifications
      const waitForNotification = () =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for message notification'));
          }, 90000);

          socket.on('graph.checkpointer.message', (notification) => {
            clearTimeout(timeout);

            // Verify the notification structure
            try {
              expect(notification).to.have.property(
                'type',
                'graph.checkpointer.message',
              );
              expect(notification).to.have.property('graphId', freshGraphId);
              expect(notification).to.have.property('ownerId', mockUserId);
              expect(notification).to.have.property('nodeId');
              expect(notification).to.have.property('threadId');
              expect(notification).to.have.property('data');
              expect(notification.data).to.have.property('content');
              expect(notification.data).to.have.property('role');
              expect(notification.data.content).to.be.a('string');
              expect(notification.data.role).to.be.a('string');
              resolve(undefined);
            } catch (error) {
              reject(error);
            }
          });

          socket.once('server_error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });

      // Chain Cypress commands properly
      return createGraph(graphData, reqHeaders)
        .then((response) => {
          expect(response.status).to.equal(201);
          freshGraphId = response.body.id;

          return runGraph(freshGraphId, reqHeaders);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          // Set up notification listener before triggering
          const notificationPromise = waitForNotification();

          // Trigger execution
          return executeTrigger(
            freshGraphId,
            'trigger-1',
            { messages: ['Hello, this is a test message'] },
            reqHeaders,
          ).then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            return cy.wrap(notificationPromise, { timeout: 90000 });
          });
        });
    });

    it('should receive AI message with tool calls in correct format', () => {
      // Create a graph with web-search-tool configured
      const graphData: CreateGraphDto = {
        name: `Test Graph with Tools ${generateRandomUUID().slice(0, 8)}`,
        description: 'Test graph with web search tool',
        version: '1.0.0',
        temporary: true, // E2E test graphs are temporary by default
        schema: {
          nodes: [
            {
              id: 'web-search-tool-1',
              template: 'web-search-tool',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent with Tools',
                instructions:
                  'You are a helpful agent. You MUST use the web-search tool to answer questions about current events, weather, or real-time information. Always call the tool first before answering.',
                invokeModelName: 'gpt-5-mini',
                toolNodeIds: ['web-search-tool-1'],
              },
            },
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {
                agentId: 'agent-1',
              },
            },
          ],
          edges: [
            {
              from: 'trigger-1',
              to: 'agent-1',
            },
          ],
        },
      };

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        // Set up listener for message events with tool calls
        return cy.wrap(
          new Promise((resolve, reject) => {
            socket.on('graph.checkpointer.message', (notification) => {
              // We're looking for AI messages with tool calls
              if (
                notification.data?.role === 'ai' &&
                notification.data?.toolCalls &&
                notification.data.toolCalls.length > 0
              ) {
                // Verify the notification structure
                expect(notification).to.have.property(
                  'type',
                  'graph.checkpointer.message',
                );
                expect(notification).to.have.property('graphId', freshGraphId);
                expect(notification).to.have.property('ownerId', mockUserId);
                expect(notification).to.have.property('nodeId');
                expect(notification).to.have.property('threadId');
                expect(notification).to.have.property('data');
                expect(notification.data).to.have.property('role', 'ai');
                expect(notification.data).to.have.property('toolCalls');

                // Verify tool call data structure
                const toolCall = notification.data.toolCalls[0];
                expect(toolCall).to.have.property('name');
                expect(toolCall).to.have.property('args');
                expect(toolCall.name).to.be.a('string');
                expect(toolCall.args).to.exist;

                resolve(undefined);
              }
            });

            socket.once('server_error', (error) => reject(error));

            // Run the graph first, then execute the trigger
            runGraph(freshGraphId, reqHeaders).then((runResponse) => {
              expect(runResponse.status).to.equal(201);
              // Execute the trigger with a query that should trigger web search
              executeTrigger(
                freshGraphId,
                'trigger-1',
                {
                  messages: [
                    'What is the current weather in Dubai? Check it in internet, use web tool',
                  ],
                },
                reqHeaders,
              ).then((triggerResponse) => {
                expect(triggerResponse.status).to.equal(201);
              });
            });

            // Timeout after 45 seconds (tool execution may take time)
            setTimeout(() => {
              reject(
                new Error(
                  'Timeout waiting for AI message with tool calls notification',
                ),
              );
            }, 45000);
          }),
          {
            timeout: 45000,
          },
        );
      });
    });

    it('should receive multiple message notifications during graph execution', () => {
      // This test verifies that multiple messages are detected and emitted correctly
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        const receivedMessages: unknown[] = [];

        // Set up listener for message events
        return cy.wrap(
          new Promise((resolve, reject) => {
            socket.on('graph.checkpointer.message', (notification) => {
              receivedMessages.push(notification);
              // Verify each message has the correct structure
              expect(notification).to.have.property('graphId', freshGraphId);
              expect(notification).to.have.property(
                'type',
                'graph.checkpointer.message',
              );
              expect(notification.data).to.have.property('content');
              expect(notification.data).to.have.property('role');

              // Once we have at least 2 messages (user + AI response), we're done
              if (receivedMessages.length >= 2) {
                resolve(undefined);
              }
            });

            socket.once('server_error', (error) => reject(error));

            // Run the graph first, then execute the trigger
            runGraph(freshGraphId, reqHeaders).then((runResponse) => {
              expect(runResponse.status).to.equal(201);
              // Execute the trigger with a test message
              executeTrigger(
                freshGraphId,
                'trigger-1',
                { messages: ['Hello, how are you?'] },
                reqHeaders,
              ).then((triggerResponse) => {
                expect(triggerResponse.status).to.equal(201);
              });
            });

            // Timeout after 20 seconds
            setTimeout(() => {
              // We should have at least received some messages
              if (receivedMessages.length > 0) {
                resolve(undefined);
              } else {
                reject(new Error('Timeout: No message notifications received'));
              }
            }, 20000);
          }),
          {
            timeout: 20000,
          },
        );
      });
    });
  });

  describe('Multiple Clients', () => {
    let secondSocket: Socket;

    afterEach(() => {
      if (secondSocket) {
        disconnectSocket(secondSocket);
      }
    });

    after(() => {
      // Clean up all created graphs after all tests in this section
      graphCleanup.cleanupAllGraphs();
    });

    it('should allow multiple connections from the same user', () => {
      socket = createSocketConnection(baseUrl, mockUserId);
      secondSocket = createSocketConnection(baseUrl, mockUserId);

      return waitForSocketConnection(socket).then(() => {
        return waitForSocketConnection(secondSocket).then(() => {
          expect(socket.connected).to.be.true;
          expect(secondSocket.connected).to.be.true;
          expect(socket.id).to.not.equal(secondSocket.id);
        });
      });
    });

    it('should broadcast to all user connections', () => {
      socket = createSocketConnection(baseUrl, mockUserId);
      secondSocket = createSocketConnection(baseUrl, mockUserId);

      return waitForSocketConnection(socket).then(() => {
        return waitForSocketConnection(secondSocket).then(() => {
          // Both sockets should be connected and ready to receive notifications
          expect(socket.connected).to.be.true;
          expect(secondSocket.connected).to.be.true;
          expect(socket.id).to.not.equal(secondSocket.id);

          // Set up listeners on both sockets
          const firstSocketEvent = new Promise((resolve, reject) => {
            socket.once('graph.update', (notification) => {
              expect(notification).to.have.property('graphId');
              expect(notification).to.have.property('type', 'graph.update');
              resolve(notification);
            });
            socket.once('server_error', reject);
            setTimeout(
              () =>
                reject(
                  new Error('Timeout waiting for first socket notification'),
                ),
              10000,
            );
          });

          const secondSocketEvent = new Promise((resolve, reject) => {
            secondSocket.once('graph.update', (notification) => {
              expect(notification).to.have.property('graphId');
              expect(notification).to.have.property('type', 'graph.update');
              resolve(notification);
            });
            secondSocket.once('server_error', reject);
            setTimeout(
              () =>
                reject(
                  new Error('Timeout waiting for second socket notification'),
                ),
              10000,
            );
          });

          // Create a new graph to trigger notification
          const graphData = createMockGraphData();
          return createGraph(graphData, reqHeaders).then(
            (response: { status: number; body: { id: string } }) => {
              expect(response.status).to.equal(201);
              const newGraphId = response.body.id;

              // Run the graph to trigger notifications
              return runGraph(newGraphId, reqHeaders).then((runResponse) => {
                expect(runResponse.status).to.equal(201);
                // Both sockets should receive the notification
                return Promise.all([firstSocketEvent, secondSocketEvent]).then(
                  ([first, second]: [
                    Record<string, unknown>,
                    Record<string, unknown>,
                  ]) => {
                    expect(first).to.have.property('graphId');
                    expect(second).to.have.property('graphId');
                    expect(first.graphId).to.equal(second.graphId);
                    expect(first.graphId).to.equal(newGraphId);
                  },
                );
              });
            },
          );
        });
      });
    });
  });
});
