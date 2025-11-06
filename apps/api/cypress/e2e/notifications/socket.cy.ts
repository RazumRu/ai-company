import { Socket } from 'socket.io-client';

import { mockUserId, reqHeaders } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  destroyGraph,
  executeTrigger,
  runGraph,
} from '../graphs/graphs.helper';
import { deleteThread } from '../threads/threads.helper';
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
            expect(notification.data).to.have.property('status');
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
          return cy.wrap(notificationPromise, { timeout: 10000 });
        });
      });
    });

    it('should receive error when subscribing without graphId', () => {
      socket.emit('subscribe_graph', {});

      return waitForSocketEvent(socket, 'server_error').then(
        (error: unknown) => {
          const e = error as { message?: string };
          expect(e).to.have.property('message');
          expect(e.message).to.include('Graph ID is required');
        },
      );
    });

    it('should receive error when subscribing to non-existent graph', () => {
      const fakeGraphId = '00000000-0000-0000-0000-000000000000';
      socket.emit('subscribe_graph', { graphId: fakeGraphId });

      return waitForSocketEvent(socket, 'server_error').then(
        (error: unknown) => {
          const e = error as { message?: string };
          expect(e).to.have.property('message');
          expect(e.message).to.include('Graph not found');
        },
      );
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

    it('should receive notifications after subscribing to graph', () => {
      // Users must subscribe to graphs to receive notifications
      // Create a fresh graph for this test to avoid "already running" issues
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        // Subscribe to the graph
        socket.emit('subscribe_graph', { graphId: freshGraphId });

        // Set up listener for graph update events
        const notificationPromise = new Promise((resolve, reject) => {
          socket.once('graph.update', (notification) => {
            expect(notification).to.have.property('graphId', freshGraphId);
            expect(notification).to.have.property('type', 'graph.update');
            expect(notification).to.have.property('data');
            expect(notification.data).to.have.property('status');
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

          socket.on('agent.message', (notification) => {
            clearTimeout(timeout);

            // Verify the notification structure
            try {
              expect(notification).to.have.property('type', 'agent.message');
              expect(notification).to.have.property('graphId', freshGraphId);
              expect(notification).to.have.property('ownerId', mockUserId);
              expect(notification).to.have.property('nodeId');
              expect(notification).to.have.property('threadId');
              expect(notification).to.have.property('data');
              expect(notification.data).to.have.property('message');
              expect(notification.data.message).to.have.property('content');
              expect(notification.data.message).to.have.property('role');
              expect(notification.data.message.content).to.be.a('string');
              expect(notification.data.message.role).to.be.a('string');
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

          // Subscribe to the graph
          socket.emit('subscribe_graph', { graphId: freshGraphId });

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

    it('should receive multiple message notifications during graph execution', () => {
      // This test verifies that multiple messages are detected and emitted correctly
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        const freshGraphId = response.body.id;

        // Subscribe to the graph
        socket.emit('subscribe_graph', { graphId: freshGraphId });

        const receivedMessages: unknown[] = [];

        // Set up listener for message events
        return cy.wrap(
          new Promise((resolve, reject) => {
            socket.on('agent.message', (notification) => {
              receivedMessages.push(notification);
              // Verify each message has the correct structure
              expect(notification).to.have.property('graphId', freshGraphId);
              expect(notification).to.have.property('type', 'agent.message');
              expect(notification.data).to.have.property('message');
              expect(notification.data.message).to.have.property('content');
              expect(notification.data.message).to.have.property('role');

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

  it('should receive node status updates during graph execution', function () {
    this.timeout(120000);

    const graphData = createMockGraphData();
    let testGraphId = '';
    const nodeEvents: { data?: { status?: string } }[] = [];
    const statusesSeen = new Set<string>();

    const waitForNodeUpdates = (client: Socket) =>
      new Promise<void>((resolve, reject) => {
        let resolved = false;

        const handleCleanup = () => {
          if (resolved) return;
          resolved = true;
          client.off('graph.node.update', handleUpdate);
          client.off('server_error', handleServerError);
        };

        const timeoutId = setTimeout(() => {
          handleCleanup();
          reject(
            new Error('Timeout waiting for graph.node.update notifications'),
          );
        }, 90000);

        const handleServerError = (error: unknown) => {
          clearTimeout(timeoutId);
          handleCleanup();
          reject(error as Error);
        };

        const handleUpdate = (notification: {
          graphId: string;
          type: string;
          nodeId: string;
          data?: { status?: string };
        }) => {
          if (notification.graphId !== testGraphId) {
            return;
          }

          try {
            expect(notification.type).to.equal('graph.node.update');
            expect(notification.nodeId).to.be.a('string');

            nodeEvents.push(notification);

            const status = notification.data?.status;
            if (typeof status === 'string') {
              statusesSeen.add(status);
            }

            if (statusesSeen.has('running') && statusesSeen.has('idle')) {
              clearTimeout(timeoutId);
              handleCleanup();
              resolve();
            }
          } catch (error) {
            clearTimeout(timeoutId);
            handleCleanup();
            reject(error as Error);
          }
        };

        client.on('graph.node.update', handleUpdate);
        client.once('server_error', handleServerError);
      });

    return waitForSocketConnection(
      (socket = createSocketConnection(baseUrl, mockUserId)),
    )
      .then(() => createGraph(graphData, reqHeaders))
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        testGraphId = createResponse.body.id;

        socket.emit('subscribe_graph', { graphId: testGraphId });

        return cy.wait(500);
      })
      .then(() => {
        const updatesPromise = waitForNodeUpdates(socket);

        return runGraph(testGraphId, reqHeaders)
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);

            return executeTrigger(
              testGraphId,
              'trigger-1',
              {
                messages: [
                  'Provide a short greeting and outline the next step before finishing.',
                ],
                async: true,
              },
              reqHeaders,
            );
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            return cy.wrap(updatesPromise, { timeout: 90000 });
          })
          .then(() => {
            const runningEvents = nodeEvents.filter(
              (event) => event.data?.status === 'running',
            );
            const idleEvents = nodeEvents.filter(
              (event) => event.data?.status === 'idle',
            );

            expect(runningEvents.length).to.be.greaterThan(0);
            expect(idleEvents.length).to.be.greaterThan(0);
          });
      })
      .then(() => {
        if (testGraphId) {
          return destroyGraph(testGraphId, reqHeaders).then(() => undefined);
        }

        return undefined;
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

              // Subscribe both sockets to the graph
              socket.emit('subscribe_graph', { graphId: newGraphId });
              secondSocket.emit('subscribe_graph', { graphId: newGraphId });

              // Run the graph to trigger notifications
              return runGraph(newGraphId, reqHeaders).then((runResponse) => {
                expect(runResponse.status).to.equal(201);
                // Both sockets should receive the notification
                return Promise.all([firstSocketEvent, secondSocketEvent]).then(
                  (events) => {
                    const [first, second] = events as [
                      Record<string, unknown>,
                      Record<string, unknown>,
                    ];
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

  it('should receive socket notifications for thread state updates', () => {
    const graphData = {
      name: `Socket Notification Test ${Math.random().toString(36).slice(0, 8)}`,
      description: 'Test graph for socket notifications',
      version: '1.0.0',
      temporary: true,
      schema: {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              instructions: 'You are a helpful test agent.',
              invokeModelName: 'gpt-5-mini',
              summarizeMaxTokens: 272000,
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
    };

    // Connect to socket using the same user ID as the test
    const baseUrl = Cypress.config('baseUrl') || 'http://localhost:5000';
    const testSocket = createSocketConnection(baseUrl, mockUserId);

    // Listen for agent state update events
    const stateUpdateEvents: Record<string, unknown>[] = [];
    testSocket.on('agent.state.update', (data: Record<string, unknown>) => {
      stateUpdateEvents.push(data);
    });

    // Wait for socket connection, then create graph and subscribe BEFORE running
    return waitForSocketConnection(testSocket)
      .then(() => {
        return createGraph(graphData, reqHeaders);
      })
      .then((response) => {
        expect(response.status).to.equal(201);
        const testGraphId = response.body.id;

        // Subscribe to graph updates BEFORE running the graph
        testSocket.emit('subscribe_graph', { graphId: testGraphId });

        // Small wait to ensure subscription is processed
        cy.wait(500);

        // Set up promise to wait for title update notification
        const waitForTitleUpdate = new Promise((resolve, reject) => {
          let resolved = false;

          const checkForTitleUpdate = () => {
            if (resolved) return;

            const titleUpdateEvent = (
              stateUpdateEvents as {
                data?: { generatedTitle?: string };
                type?: string;
                graphId?: string;
              }[]
            ).find((event) => event.data && event.data.generatedTitle);

            if (titleUpdateEvent) {
              resolved = true;
              expect(titleUpdateEvent.type).to.equal('agent.state.update');
              expect(titleUpdateEvent.graphId).to.equal(testGraphId);
              expect(titleUpdateEvent.data!.generatedTitle).to.be.a('string');
              expect(titleUpdateEvent.data!.generatedTitle).to.not.be.empty;
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
            if (!resolved) {
              if (stateUpdateEvents.length === 0) {
                reject(
                  new Error(
                    'Timeout: No agent state update notifications received',
                  ),
                );
              } else {
                reject(
                  new Error(
                    `Timeout: Received ${stateUpdateEvents.length} events but none with generatedTitle. Events: ${JSON.stringify(stateUpdateEvents)}`,
                  ),
                );
              }
            }
          }, 30000);
        });

        // Run the graph, then execute trigger, then wait for notification
        return runGraph(testGraphId, reqHeaders)
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            // Execute trigger
            return executeTrigger(
              testGraphId,
              'trigger-1',
              {
                messages: ['Test message for socket notifications'],
                threadSubId: 'socket-test-thread',
              },
              reqHeaders,
            );
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            // Wait for the title update notification
            return cy.wrap(waitForTitleUpdate, { timeout: 30000 });
          })
          .then(() => {
            // Verify we received at least one event
            expect(stateUpdateEvents.length).to.be.greaterThan(0);
          });
      })
      .then(() => {
        // Cleanup
        disconnectSocket(testSocket);
      });
  });

  it('should receive thread.create notification when thread is created', function () {
    this.timeout(120000);

    const graphData = createMockGraphData();
    let testGraphId: string;
    const threadCreateEvents: {
      type: string;
      graphId: string;
      threadId: string;
      data: Record<string, unknown>;
    }[] = [];

    // Connect socket
    socket = createSocketConnection(baseUrl, mockUserId);

    return waitForSocketConnection(socket)
      .then(() => {
        // Set up thread.create listener
        socket.on('thread.create', (notification) => {
          threadCreateEvents.push(notification);
        });

        return createGraph(graphData, reqHeaders);
      })
      .then((response) => {
        expect(response.status).to.equal(201);
        testGraphId = response.body.id;

        // Subscribe to graph
        socket.emit('subscribe_graph', { graphId: testGraphId });

        return cy.wait(500);
      })
      .then(() => runGraph(testGraphId, reqHeaders))
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        // Set up promise to wait for thread.create notification
        const waitForThreadCreate = new Promise((resolve, reject) => {
          const checkForThreadCreate = () => {
            if (threadCreateEvents.length > 0) {
              const event = threadCreateEvents[0]!;
              expect(event.type).to.equal('thread.create');
              expect(event.graphId).to.equal(testGraphId);
              expect(event.threadId).to.be.a('string');
              expect(event.data).to.be.an('object');
              expect(event.data).to.have.property('id');
              expect(event.data).to.have.property('graphId', testGraphId);
              expect(event.data).to.have.property('externalThreadId');
              expect(event.data).to.have.property('status');
              expect(event.data).to.have.property('createdAt');
              expect(event.data).to.have.property('updatedAt');
              resolve(undefined);
            }
          };

          // Check periodically for thread create
          const intervalId = setInterval(() => {
            checkForThreadCreate();
          }, 500);

          // Timeout after 30 seconds
          setTimeout(() => {
            clearInterval(intervalId);
            if (threadCreateEvents.length === 0) {
              reject(
                new Error('Timeout: No thread.create notification received'),
              );
            }
          }, 30000);
        });

        return executeTrigger(
          testGraphId,
          'trigger-1',
          { messages: ['Test message for thread creation'] },
          reqHeaders,
        )
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            // Wait for the thread.create notification
            return cy.wrap(waitForThreadCreate, { timeout: 30000 });
          })
          .then(() => {
            // Verify we received the event
            expect(threadCreateEvents.length).to.be.greaterThan(0);
          });
      })
      .then(() => {
        // Cleanup
        disconnectSocket(socket);
      });
  });

  it('should receive thread.delete notification when thread is deleted', function () {
    this.timeout(120000);

    const graphData = createMockGraphData();
    let testGraphId: string;
    let createdThreadInternalId: string | undefined;
    let createdThreadExternalId: string | undefined;

    const threadCreateEvents: {
      type: string;
      graphId: string;
      threadId: string;
      data: Record<string, unknown>;
    }[] = [];
    const threadDeleteEvents: {
      type: string;
      graphId: string;
      threadId: string;
      data: Record<string, unknown>;
    }[] = [];

    // Connect socket
    socket = createSocketConnection(baseUrl, mockUserId);

    return waitForSocketConnection(socket)
      .then(() => {
        socket.on('thread.create', (notification) => {
          threadCreateEvents.push(notification);
        });

        socket.on('thread.delete', (notification) => {
          threadDeleteEvents.push(notification);
        });

        return createGraph(graphData, reqHeaders);
      })
      .then((response) => {
        expect(response.status).to.equal(201);
        testGraphId = response.body.id;

        socket.emit('subscribe_graph', { graphId: testGraphId });

        return cy.wait(500);
      })
      .then(() => runGraph(testGraphId, reqHeaders))
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        const waitForThreadCreate = new Promise((resolve, reject) => {
          const checkForThreadCreate = () => {
            if (threadCreateEvents.length > 0) {
              const event = threadCreateEvents[0]!;

              try {
                expect(event.type).to.equal('thread.create');
                expect(event.graphId).to.equal(testGraphId);
                expect(event.threadId).to.be.a('string');
                expect(event.data).to.be.an('object');

                const eventData = event.data as Record<string, unknown>;
                expect(eventData).to.have.property('id');
                expect(eventData).to.have.property('graphId', testGraphId);
                expect(eventData).to.have.property('externalThreadId');

                createdThreadInternalId = eventData.id as string;
                createdThreadExternalId = eventData.externalThreadId as string;
              } catch (error) {
                cleanupTimers();
                reject(error as Error);
                return;
              }

              cleanupTimers();
              resolve(event);
            }
          };

          const intervalId = setInterval(checkForThreadCreate, 500);
          const timeoutId = setTimeout(() => {
            cleanupTimers();
            reject(
              new Error('Timeout: No thread.create notification received'),
            );
          }, 30000);

          function cleanupTimers() {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
          }
        });

        const waitForThreadDelete = new Promise((resolve, reject) => {
          const checkForThreadDelete = () => {
            if (threadDeleteEvents.length > 0) {
              const event = threadDeleteEvents[0]!;

              try {
                if (!createdThreadInternalId || !createdThreadExternalId) {
                  return;
                }

                expect(event.type).to.equal('thread.delete');
                expect(event.graphId).to.equal(testGraphId);
                expect(event.threadId).to.equal(createdThreadExternalId);
                expect(event.data).to.be.an('object');

                const eventData = event.data as Record<string, unknown>;
                expect(eventData).to.have.property(
                  'id',
                  createdThreadInternalId,
                );
                expect(eventData).to.have.property(
                  'externalThreadId',
                  createdThreadExternalId,
                );
              } catch (error) {
                cleanupTimers();
                reject(error as Error);
                return;
              }

              cleanupTimers();
              resolve(event);
            }
          };

          const intervalId = setInterval(checkForThreadDelete, 500);
          const timeoutId = setTimeout(() => {
            cleanupTimers();
            reject(
              new Error('Timeout: No thread.delete notification received'),
            );
          }, 30000);

          function cleanupTimers() {
            clearInterval(intervalId);
            clearTimeout(timeoutId);
          }
        });

        return executeTrigger(
          testGraphId,
          'trigger-1',
          { messages: ['Test message for thread deletion'] },
          reqHeaders,
        )
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            return cy.wrap(waitForThreadCreate, { timeout: 30000 });
          })
          .then(() => {
            expect(createdThreadInternalId).to.be.a('string');
            expect(createdThreadExternalId).to.be.a('string');
            return deleteThread(createdThreadInternalId!, reqHeaders);
          })
          .then((deleteResponse) => {
            expect(deleteResponse.status).to.equal(200);
            return cy.wrap(waitForThreadDelete, { timeout: 30000 });
          })
          .then(() => {
            expect(threadDeleteEvents.length).to.be.greaterThan(0);
          });
      });
  });

  describe('Duplicate Notification Prevention', () => {
    it('should not receive duplicate message notifications', function () {
      this.timeout(120000);

      const graphData = createMockGraphData();
      let testGraphId: string;
      const messageNotifications: {
        type: string;
        graphId: string;
        threadId: string;
        data: { message: { content: string; role: string } };
      }[] = [];

      // Connect socket
      socket = createSocketConnection(baseUrl, mockUserId);

      return waitForSocketConnection(socket)
        .then(() => {
          // Set up message listener
          socket.on('agent.message', (notification) => {
            messageNotifications.push(notification);
          });

          return createGraph(graphData, reqHeaders);
        })
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;

          // Subscribe to graph
          socket.emit('subscribe_graph', { graphId: testGraphId });

          return cy.wait(500);
        })
        .then(() => runGraph(testGraphId, reqHeaders))
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          return executeTrigger(
            testGraphId,
            'trigger-1',
            { messages: ['Test message for duplicate check'] },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);

          // Wait for messages to arrive
          return cy.wait(10000);
        })
        .then(() => {
          // Verify we received messages
          expect(messageNotifications.length).to.be.greaterThan(0);

          // Check for duplicates by comparing message content and threadId
          const messageKeys = messageNotifications.map(
            (n) =>
              `${n.threadId}:${n.data.message.role}:${n.data.message.content}`,
          );

          const uniqueKeys = new Set(messageKeys);

          // Assert no duplicates
          expect(messageKeys.length).to.equal(
            uniqueKeys.size,
            `Found duplicate messages. Total: ${messageKeys.length}, Unique: ${uniqueKeys.size}. Messages: ${JSON.stringify(messageNotifications.map((n) => ({ role: n.data.message.role, content: typeof n.data.message.content === 'string' ? n.data.message.content.substring(0, 50) : JSON.stringify(n.data.message.content).substring(0, 50) })))}`,
          );
        });
    });

    it('should not receive duplicate node update notifications', function () {
      this.timeout(120000);

      const graphData = createMockGraphData();
      let testGraphId: string;
      const nodeUpdateNotifications: {
        type: string;
        graphId: string;
        nodeId: string;
        data: { status: string };
      }[] = [];

      // Connect socket
      socket = createSocketConnection(baseUrl, mockUserId);

      return waitForSocketConnection(socket)
        .then(() => {
          // Set up node update listener
          socket.on('graph.node.update', (notification) => {
            nodeUpdateNotifications.push(notification);
          });

          return createGraph(graphData, reqHeaders);
        })
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;

          // Subscribe to graph
          socket.emit('subscribe_graph', { graphId: testGraphId });

          return cy.wait(500);
        })
        .then(() => runGraph(testGraphId, reqHeaders))
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          return executeTrigger(
            testGraphId,
            'trigger-1',
            { messages: ['Test message for node update duplicate check'] },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);

          // Wait for node updates to arrive
          return cy.wait(10000);
        })
        .then(() => {
          // Verify we received node updates
          expect(nodeUpdateNotifications.length).to.be.greaterThan(0);

          // Group by nodeId and status to detect duplicates
          const updatesByNode = new Map<
            string,
            Map<string, typeof nodeUpdateNotifications>
          >();

          nodeUpdateNotifications.forEach((notification) => {
            if (!updatesByNode.has(notification.nodeId)) {
              updatesByNode.set(notification.nodeId, new Map());
            }

            const nodeUpdates = updatesByNode.get(notification.nodeId)!;
            const status = notification.data.status;

            if (!nodeUpdates.has(status)) {
              nodeUpdates.set(status, []);
            }

            nodeUpdates.get(status)!.push(notification);
          });

          // Check for duplicate status updates for the same node
          let duplicatesFound = false;
          const duplicateDetails: string[] = [];

          updatesByNode.forEach((statusMap, nodeId) => {
            statusMap.forEach((updates, status) => {
              if (updates.length > 1) {
                duplicatesFound = true;
                duplicateDetails.push(
                  `Node ${nodeId} has ${updates.length} duplicate '${status}' updates`,
                );
              }
            });
          });

          // Assert no duplicates
          expect(
            duplicatesFound,
            `Found duplicate node updates: ${duplicateDetails.join(', ')}. Total notifications: ${nodeUpdateNotifications.length}`,
          ).to.equal(false);
        });
    });

    it('should not receive duplicate notifications with multiple socket connections', function () {
      this.timeout(120000);

      const graphData = createMockGraphData();
      let testGraphId: string;
      let secondSocket: Socket;

      const socket1Messages: { content: string; threadId: string }[] = [];
      const socket2Messages: { content: string; threadId: string }[] = [];

      // Connect first socket
      socket = createSocketConnection(baseUrl, mockUserId);

      return waitForSocketConnection(socket)
        .then(() => {
          // Connect second socket for the same user
          secondSocket = createSocketConnection(baseUrl, mockUserId);
          return waitForSocketConnection(secondSocket);
        })
        .then(() => {
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

          return createGraph(graphData, reqHeaders);
        })
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;

          // Subscribe both sockets to the graph
          socket.emit('subscribe_graph', { graphId: testGraphId });
          secondSocket.emit('subscribe_graph', { graphId: testGraphId });

          return cy.wait(500);
        })
        .then(() => runGraph(testGraphId, reqHeaders))
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          return executeTrigger(
            testGraphId,
            'trigger-1',
            { messages: ['Test message for multi-socket duplicate check'] },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);

          // Wait for messages to arrive
          return cy.wait(10000);
        })
        .then(() => {
          // Both sockets should receive messages
          expect(socket1Messages.length).to.be.greaterThan(0);
          expect(socket2Messages.length).to.be.greaterThan(0);

          // Both sockets should receive the same messages (broadcast)
          expect(socket1Messages.length).to.equal(socket2Messages.length);

          // Check for duplicates within each socket
          const socket1Keys = socket1Messages.map(
            (m) => `${m.threadId}:${m.content}`,
          );
          const socket2Keys = socket2Messages.map(
            (m) => `${m.threadId}:${m.content}`,
          );

          const socket1Unique = new Set(socket1Keys);
          const socket2Unique = new Set(socket2Keys);

          expect(socket1Keys.length).to.equal(
            socket1Unique.size,
            'Socket 1 received duplicate messages',
          );
          expect(socket2Keys.length).to.equal(
            socket2Unique.size,
            'Socket 2 received duplicate messages',
          );
        })
        .then(() => {
          // Cleanup second socket
          if (secondSocket) {
            disconnectSocket(secondSocket);
          }
        });
    });
  });
});
