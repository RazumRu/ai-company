import { buildAuthHeaders, generateRandomUUID } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  runGraph,
  waitForGraphToBeRunning,
} from '../graphs/graphs.helper';
import {
  deleteThread,
  getThreadByExternalId,
  getThreadById,
  getThreadMessages,
  getThreads,
  getThreadUsageStatistics,
  stopThread,
  stopThreadByExternalId,
  waitForThreadStatus,
} from './threads.helper';

describe('Threads E2E', () => {
  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('Multi-Agent Thread Management', () => {
    it('should retrieve thread by ID', () => {
      let testGraphId: string;
      let internalThreadId: string;

      const graphData = {
        name: `Thread Retrieval Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for thread retrieval',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                description: 'Test agent for thread retrieval',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
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

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Retrieve this thread'],
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          const threadId = triggerResponse.body.externalThreadId;

          return getThreadByExternalId(threadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('id');
          internalThreadId = threadResponse.body.id;

          return getThreadById(internalThreadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('id', internalThreadId);

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should retrieve thread by external ID', () => {
      let testGraphId: string;
      let externalThreadId: string;

      const graphData = {
        name: `External Thread Retrieval Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for external thread retrieval',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                description: 'Test agent for external thread retrieval',
                instructions: 'You are a helpful test agent.',
                invokeModelName: 'gpt-5-mini',
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

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Test external thread retrieval'],
            threadSubId: 'external-retrieval-test',
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          externalThreadId = triggerResponse.body.externalThreadId;
          cy.wait(2000);

          // Test retrieving thread by external ID
          return getThreadByExternalId(externalThreadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('graphId', testGraphId);
          expect(threadResponse.body).to.have.property(
            'externalThreadId',
            externalThreadId,
          );

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should list threads without specifying graphId', () => {
      let testGraphId: string;

      const graphData = createMockGraphData();

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['List all threads'],
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          cy.wait(2000);

          return getThreads();
        })
        .then((threadsResponse) => {
          expect(threadsResponse.status).to.equal(200);
          expect(threadsResponse.body).to.be.an('array');
          const matchingThread = threadsResponse.body.find(
            (thread) => thread.graphId === testGraphId,
          );
          expect(matchingThread).to.exist;
          expect(matchingThread?.externalThreadId).to.be.a('string');

          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should filter messages by nodeId', () => {
      let testGraphId: string;
      let internalThreadId: string;

      // Create a graph with 2 agents
      const graphData = {
        name: `Filter Messages Test ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph for message filtering',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'First Agent',
                description: 'First agent in filter test',
                instructions:
                  'You are the first agent. Use the agent-communication tool to ask the second agent a simple question.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'agent-2',
              template: 'simple-agent',
              config: {
                name: 'Second Agent',
                description: 'Second agent in filter test',
                instructions: 'You are the second agent. Answer briefly.',
                invokeModelName: 'gpt-5-mini',
              },
            },
            {
              id: 'comm-tool',
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
            { from: 'agent-1', to: 'comm-tool' },
            { from: 'comm-tool', to: 'agent-2' },
          ],
        },
      };

      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          cy.wait(2000);

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: ['Ask agent 2 what is 1+1'],
            threadSubId: 'filter-test',
          })
            .then((triggerResponse) => {
              expect(triggerResponse.status).to.equal(201);
              const threadId = triggerResponse.body.externalThreadId;
              cy.wait(5000);

              // Get thread by external ID
              return getThreadByExternalId(threadId);
            })
            .then((threadResponse) => {
              expect(threadResponse.status).to.equal(200);
              internalThreadId = threadResponse.body.id;

              // Get all messages
              return getThreadMessages(internalThreadId);
            })
            .then((allMessagesResponse) => {
              expect(allMessagesResponse.status).to.equal(200);
              const allMessages = allMessagesResponse.body;

              // Get messages from agent-1 only
              return getThreadMessages(internalThreadId, {
                nodeId: 'agent-1',
              }).then((agent1Response) => {
                expect(agent1Response.status).to.equal(200);
                const agent1Messages = agent1Response.body;

                // All filtered messages should be from agent-1
                agent1Messages.forEach((msg) => {
                  expect(msg.nodeId).to.equal('agent-1');
                });

                // Should have fewer messages than total
                expect(agent1Messages.length).to.be.lessThan(
                  allMessages.length,
                );

                // Cleanup
                destroyGraph(testGraphId).then(() => {
                  deleteGraph(testGraphId);
                });
              });
            });
        });
    });

    describe('Message Retrieval and Thread Management', () => {
      it('should retrieve messages for a thread after execution', () => {
        const testMessage = 'Hello, test agent!';
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute a trigger to create some messages
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [testMessage],
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            expect(triggerResponse.body).to.have.property('externalThreadId');
            expect(triggerResponse.body).to.have.property('checkpointNs');

            // Get messages using thread API
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              if (!internalThreadId) {
                throw new Error(
                  'Expected an internal thread id to be returned',
                );
              }
              return getThreadMessages(internalThreadId);
            });
          })
          .then((response) => {
            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
            expect(response.body.length).to.be.greaterThan(0);

            // Verify our sent message is included
            const humanMessage = response.body
              .map((m) => m.message)
              .find((msg) => msg.role === 'human');
            expect(humanMessage).to.exist;
            expect(humanMessage?.content).to.include(testMessage);

            // Verify message structure
            const firstMessage = response.body[0]?.message;
            expect(firstMessage).to.have.property('role');
            expect(firstMessage).to.have.property('content');

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should limit messages when limit parameter is provided', () => {
        let testGraphId: string;

        // Create and run a test graph
        const graphData = createMockGraphData();
        createGraph(graphData)
          .then((response) => {
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            // Wait for graph to fully initialize
            cy.wait(2000);

            // Execute to create messages with custom threadId
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message with multiple interactions'],
              threadSubId: 'limit-test-thread',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            // Get messages with limit
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              if (!internalThreadId) {
                throw new Error(
                  'Expected an internal thread id to be returned',
                );
              }
              return getThreadMessages(internalThreadId, { limit: 2 });
            });
          })
          .then((response) => {
            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
            expect(response.body.length).to.be.at.most(2);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should execute trigger with async=true and return immediately', () => {
        let testGraphId = '';

        const graphData = createMockGraphData();

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Say hello and then finish.'],
              async: true,
            });
          })
          .then((execResponse) => {
            expect(execResponse.status).to.equal(201);
            expect(execResponse.body).to.have.property('externalThreadId');
            expect(execResponse.body).to.have.property('checkpointNs');
          })
          .then(() => {
            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });

    describe('Thread Deletion', () => {
      it('should delete a thread and its messages', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Delete Thread Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for thread deletion',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  description: 'Test agent for thread deletion',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
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

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message for deletion'],
              threadSubId: 'delete-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            // Get thread by external ID
            return getThreadByExternalId(triggerResponse.body.externalThreadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Verify thread exists and has messages
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(200);
            expect(messagesResponse.body.length).to.be.greaterThan(0);

            // Delete the thread
            return deleteThread(internalThreadId);
          })
          .then((deleteResponse) => {
            expect(deleteResponse.status).to.equal(200);

            // Verify thread is deleted - should return 404
            return getThreadById(internalThreadId);
          })
          .then((getResponse) => {
            expect(getResponse.status).to.equal(404);

            // Verify messages are also deleted
            return getThreadMessages(internalThreadId);
          })
          .then((messagesResponse) => {
            expect(messagesResponse.status).to.equal(404);

            // Verify thread is not in the threads list
            return getThreads({ graphId: testGraphId });
          })
          .then((threadsResponse) => {
            expect(threadsResponse.status).to.equal(200);
            expect(threadsResponse.body.length).to.equal(0);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should return 404 when trying to delete non-existent thread', () => {
        // Use a valid UUID format that doesn't exist
        const nonExistentThreadId = generateRandomUUID();

        deleteThread(nonExistentThreadId).then((response) => {
          expect(response.status).to.equal(404);
        });
      });

      it('should not allow deleting thread from different user', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Cross User Delete Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for cross-user deletion',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  description: 'Test agent for cross-user deletion',
                  instructions: 'You are a helpful test agent.',
                  invokeModelName: 'gpt-5-mini',
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

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Test message'],
              threadSubId: 'cross-user-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);

            return getThreadByExternalId(triggerResponse.body.externalThreadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Try to delete with different user headers (simulating different user)
            const differentUserHeaders = buildAuthHeaders({
              userId: crypto.randomUUID(), // Different user ID
            });

            return deleteThread(internalThreadId, differentUserHeaders);
          })
          .then((deleteResponse) => {
            // Should return 404 because thread doesn't belong to this user
            expect(deleteResponse.status).to.equal(404);

            // Verify thread still exists for original user
            return getThreadById(internalThreadId);
          })
          .then((getResponse) => {
            expect(getResponse.status).to.equal(200);
            expect(getResponse.body.id).to.equal(internalThreadId);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });

    describe('Thread Usage Statistics', () => {
      it('should retrieve usage statistics for a thread', () => {
        let testGraphId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Usage Statistics Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for usage statistics endpoint',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent',
                  description: 'Test agent for usage statistics',
                  instructions: 'Answer briefly with one sentence.',
                  invokeModelName: 'gpt-5-mini',
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

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            cy.wait(2000);

            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['What is 2+2?'],
              threadSubId: 'usage-stats-test',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            cy.wait(5000); // Wait for execution to complete

            return getThreadByExternalId(triggerResponse.body.externalThreadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            // Thread response should not include tokenUsage
            expect(threadResponse.body).to.not.have.property('tokenUsage');

            // Get usage statistics via the separate endpoint
            return getThreadUsageStatistics(internalThreadId);
          })
          .then((statsResponse) => {
            expect(statsResponse.status).to.equal(200);
            const stats = statsResponse.body;

            // Verify structure
            expect(stats).to.have.property('total');
            expect(stats).to.have.property('byNode');
            expect(stats).to.have.property('byTool');
            expect(stats).to.have.property('toolsAggregate');
            expect(stats).to.have.property('userMessageCount');

            // Verify total has token counts
            expect(stats.total).to.have.property('totalTokens');
            expect(stats.total.totalTokens).to.be.greaterThan(0);
            expect(stats.total).to.have.property('inputTokens');
            expect(stats.total).to.have.property('outputTokens');

            // Verify byNode has the agent
            expect(stats.byNode).to.have.property('agent-1');
            expect(stats.byNode['agent-1']?.totalTokens).to.be.greaterThan(0);

            // Verify user message count
            expect(stats.userMessageCount).to.be.greaterThan(0);

            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should return 404 for non-existent thread', () => {
        const nonExistentThreadId = generateRandomUUID();

        getThreadUsageStatistics(nonExistentThreadId).then((response) => {
          expect(response.status).to.equal(404);
        });
      });
    });

    describe('Thread Stop Execution', () => {
      it('should stop a running thread by externalThreadId', () => {
        let testGraphId: string;
        let externalThreadId: string;

        const graphData = {
          name: `Thread Stop Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for thread stop execution',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'trigger-1',
                template: 'manual-trigger',
                config: {},
              },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Command Agent',
                  description: 'Agent that executes a shell sleep command',
                  instructions:
                    'When asked, call shell to run the exact command requested, then finish.',
                  invokeModelName: 'gpt-5-mini',
                  maxIterations: 50,
                },
              },
              {
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {},
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((response) => {
            expect(response.status).to.equal(201);

            return waitForGraphToBeRunning(testGraphId);
          })
          .then(() => {
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Run this command: sleep 60'],
              async: true,
              threadSubId: 'e2e-stop-thread',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            externalThreadId = triggerResponse.body.externalThreadId;
            cy.wait(5000);

            return stopThreadByExternalId(externalThreadId);
          })
          .then((stopResponse) => {
            expect([200, 201]).to.contain(stopResponse.status);

            return waitForThreadStatus(externalThreadId, 'stopped', 20, 3000);
          })
          .then(() => {
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should stop a running thread by internal thread id', () => {
        let testGraphId: string;
        let externalThreadId: string;
        let internalThreadId: string;

        const graphData = {
          name: `Thread Stop Internal Test ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph for internal thread stop execution',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              { id: 'trigger-1', template: 'manual-trigger', config: {} },
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Command Agent',
                  description: 'Agent that executes a shell sleep command',
                  instructions:
                    'When asked, call shell to run the exact command requested, then finish.',
                  invokeModelName: 'gpt-5-mini',
                  maxIterations: 50,
                },
              },
              { id: 'shell-1', template: 'shell-tool', config: {} },
              {
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {},
                },
              },
            ],
            edges: [
              { from: 'trigger-1', to: 'agent-1' },
              { from: 'agent-1', to: 'shell-1' },
              { from: 'shell-1', to: 'runtime-1' },
            ],
          },
        };

        createGraph(graphData)
          .then((response) => {
            expect(response.status).to.equal(201);
            testGraphId = response.body.id;
            return runGraph(testGraphId);
          })
          .then((response) => {
            expect(response.status).to.equal(201);

            return waitForGraphToBeRunning(testGraphId);
          })
          .then(() => {
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: ['Run this command: sleep 60'],
              async: true,
              threadSubId: 'e2e-stop-thread-internal',
            });
          })
          .then((triggerResponse) => {
            expect(triggerResponse.status).to.equal(201);
            externalThreadId = triggerResponse.body.externalThreadId;
            cy.wait(5000);

            return getThreadByExternalId(externalThreadId);
          })
          .then((threadResponse) => {
            expect(threadResponse.status).to.equal(200);
            internalThreadId = threadResponse.body.id;

            return stopThread(internalThreadId);
          })
          .then((stopResponse) => {
            expect([200, 201]).to.contain(stopResponse.status);

            return waitForThreadStatus(externalThreadId, 'stopped', 20, 3000);
          })
          .then(() => {
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });
    });
  });
});
