import { Socket } from 'socket.io-client';

import { mockUserId, reqHeaders } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
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
      return createGraph(graphData, reqHeaders).then(
        (response: { body: { id: string } }) => {
          createdGraphId = response.body.id;
        },
      );
    });

    beforeEach(() => {
      socket = createSocketConnection(baseUrl, mockUserId);
      return waitForSocketConnection(socket);
    });

    it('should subscribe to graph updates when user is owner', () => {
      // Create a fresh graph for this test to avoid "already running" issues
      const graphData = createMockGraphData();

      return createGraph(graphData, reqHeaders).then(
        (response: { body: { id: string } }) => {
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
              reject(
                new Error('Timeout waiting for graph update notification'),
              );
            }, 10000);
          });

          // Trigger a graph action that will emit notifications
          // Running the graph will trigger compilation events
          return runGraph(freshGraphId, reqHeaders).then(() => {
            // Graph run request completed, now wait for notification
            return notificationPromise;
          });
        },
      );
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
        return createGraph(graphData, reqHeaders).then(
          (response: { body: { id: string } }) => {
            createdGraphId = response.body.id;
          },
        );
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

      return createGraph(graphData, reqHeaders).then(
        (response: { body: { id: string } }) => {
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
              reject(
                new Error('Timeout waiting for graph update notification'),
              );
            }, 10000);
          });

          // Trigger a graph action that will emit notifications
          // Running the graph will trigger compilation events
          return runGraph(freshGraphId, reqHeaders).then(() => {
            // Graph run request completed, now wait for notification
            return notificationPromise;
          });
        },
      );
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
            (response: { body: { id: string } }) => {
              const newGraphId = response.body.id;

              // Run the graph to trigger notifications
              return runGraph(newGraphId, reqHeaders).then(() => {
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
