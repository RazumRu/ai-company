import { buildAuthHeaders, generateRandomUUID } from '../common.helper';
import { graphCleanup } from '../graphs/graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  runGraph,
} from '../graphs/graphs.helper';
import {
  deleteThread,
  getThreadByExternalId,
  getThreadById,
  getThreadMessages,
  getThreads,
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
          const threadId = triggerResponse.body.threadId;

          return getThreadByExternalId(threadId);
        })
        .then((threadResponse) => {
          expect(threadResponse.status).to.equal(200);
          expect(threadResponse.body).to.have.property('id');
          internalThreadId = threadResponse.body.id;

          return getThreadById(internalThreadId!);
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
          externalThreadId = triggerResponse.body.threadId;
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
              const threadId = triggerResponse.body.threadId;
              cy.wait(5000);

              // Get thread by external ID
              return getThreadByExternalId(threadId);
            })
            .then((threadResponse) => {
              expect(threadResponse.status).to.equal(200);
              internalThreadId = threadResponse.body.id;

              // Get all messages
              return getThreadMessages(internalThreadId!);
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
            expect(triggerResponse.body).to.have.property('threadId');
            expect(triggerResponse.body).to.have.property('checkpointNs');

            // Get messages using thread API
            return getThreads({ graphId: testGraphId }).then((threadsRes) => {
              const internalThreadId = threadsRes.body[0]?.id;
              return getThreadMessages(internalThreadId!);
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
              return getThreadMessages(internalThreadId!, { limit: 2 });
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
            expect(execResponse.body).to.have.property('threadId');
            expect(execResponse.body).to.have.property('checkpointNs');
          })
          .then(() => {
            // Cleanup
            destroyGraph(testGraphId).then(() => {
              deleteGraph(testGraphId);
            });
          });
      });

      it('should isolate messages between different threads', () => {
        const thread1Message = 'Message for thread 1';
        const thread2Message = 'Message for thread 2';
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

            // Execute trigger for thread 1
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread1Message],
              threadSubId: 'thread-1',
            });
          })
          .then((response1) => {
            expect(response1.status).to.equal(201);
            const thread1Component = response1.body.threadId.split(':')[1];

            // Execute trigger for thread 2
            return executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread2Message],
              threadSubId: 'thread-2',
            }).then((response2) => {
              expect(response2.status).to.equal(201);
              const thread2Component = response2.body.threadId.split(':')[1];

              // Get messages for thread 1
              return getThreads({ graphId: testGraphId })
                .then((threadsRes) => {
                  const thread1InternalId = threadsRes.body.find(
                    (t) =>
                      t.externalThreadId ===
                      `${testGraphId}:${thread1Component}`,
                  )?.id;
                  return getThreadMessages(thread1InternalId!);
                })
                .then((messagesResponse1) => {
                  expect(messagesResponse1.status).to.equal(200);
                  expect(messagesResponse1.body.length).to.be.greaterThan(0);

                  const thread1Messages = messagesResponse1.body.map(
                    (m) => m.message,
                  );
                  const thread1HumanMsg = thread1Messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(thread1HumanMsg).to.exist;
                  expect(thread1HumanMsg?.content).to.equal(thread1Message);

                  // Verify thread 2 message is NOT in thread 1
                  const thread2MessageInThread1 = thread1Messages.find(
                    (msg) => msg.content === thread2Message,
                  );
                  expect(thread2MessageInThread1).to.not.exist;

                  // Get messages for thread 2
                  return getThreads({ graphId: testGraphId }).then(
                    (threadsRes) => {
                      const thread2InternalId = threadsRes.body.find(
                        (t) =>
                          t.externalThreadId ===
                          `${testGraphId}:${thread2Component}`,
                      )?.id;
                      return getThreadMessages(thread2InternalId!);
                    },
                  );
                })
                .then((messagesResponse2) => {
                  expect(messagesResponse2.status).to.equal(200);
                  expect(messagesResponse2.body.length).to.be.greaterThan(0);

                  const thread2Messages = messagesResponse2.body.map(
                    (m) => m.message,
                  );
                  const thread2HumanMsg = thread2Messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(thread2HumanMsg).to.exist;
                  expect(thread2HumanMsg?.content).to.equal(thread2Message);

                  // Verify thread 1 message is NOT in thread 2
                  const thread1MessageInThread2 = thread2Messages.find(
                    (msg) => msg.content === thread1Message,
                  );
                  expect(thread1MessageInThread2).to.not.exist;

                  // Cleanup
                  destroyGraph(testGraphId).then(() => {
                    deleteGraph(testGraphId);
                  });
                });
            });
          });
      });

      it('should isolate messages between different threadSubIds with aggressive summarization', () => {
        const thread1Message = 'Hello from thread 1 - what is 2+2?';
        const thread2Message = 'Hello from thread 2 - what is 3+3?';
        let testGraphId: string;

        // Create a graph with aggressive summarization settings
        const graphData = {
          name: `Test Graph with Aggressive Summarization ${Math.random().toString(36).slice(0, 8)}`,
          description: 'Test graph with aggressive summarization settings',
          version: '1.0.0',
          temporary: true,
          schema: {
            nodes: [
              {
                id: 'agent-1',
                template: 'simple-agent',
                config: {
                  name: 'Test Agent with Aggressive Summarization',
                  instructions:
                    'You are a helpful test agent. Please provide detailed responses to test summarization behavior.',
                  invokeModelName: 'gpt-5-mini',
                  summarizeMaxTokens: 30, // Very low max tokens to force summarization
                  summarizeKeepTokens: 15, // Very low keep tokens
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
                to: 'agent-1',
              },
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

            // Execute trigger for thread 1 with multiple messages to trigger summarization
            executeTrigger(testGraphId, 'trigger-1', {
              messages: [
                thread1Message,
                'This is a follow-up message to trigger summarization with aggressive settings.',
                'Another message to ensure we exceed the token limit.',
                'Yet another message to force summarization.',
              ],
              threadSubId: 'isolation-thread-1',
            }).then((response1) => {
              expect(response1.status).to.equal(201);
              expect(response1.body).to.have.property('threadId');
              const thread1Id = response1.body.threadId;

              // Execute trigger for thread 2 with multiple messages to trigger summarization
              executeTrigger(testGraphId, 'trigger-1', {
                messages: [
                  thread2Message,
                  'This is a follow-up message to trigger summarization with aggressive settings.',
                  'Another message to ensure we exceed the token limit.',
                  'Yet another message to force summarization.',
                ],
                threadSubId: 'isolation-thread-2',
              }).then((response2) => {
                expect(response2.status).to.equal(201);
                expect(response2.body).to.have.property('threadId');
                const thread2Id = response2.body.threadId;

                // Verify thread IDs are different
                expect(thread1Id).to.not.equal(thread2Id);

                // Get messages for thread 1
                getThreads({ graphId: testGraphId })
                  .then((threadsRes) => {
                    const thread1InternalId = threadsRes.body.find(
                      (t) => t.externalThreadId === thread1Id,
                    )?.id;
                    return getThreadMessages(thread1InternalId!);
                  })
                  .then((messagesResponse1) => {
                    expect(messagesResponse1.status).to.equal(200);
                    expect(messagesResponse1.body).to.be.an('array');
                    expect(messagesResponse1.body.length).to.be.greaterThan(0);

                    const thread1Messages = messagesResponse1.body.map(
                      (m) => m.message,
                    );

                    // Check for system message indicating summarization occurred
                    // With multiple messages and aggressive summarization settings, summarization should occur
                    const summarySystemMessage = thread1Messages.find(
                      (msg) =>
                        msg.role === 'system' &&
                        typeof msg.content === 'string' &&
                        msg.content.includes('Summary updated'),
                    );
                    expect(summarySystemMessage).to.exist;
                    expect(summarySystemMessage?.content).to.include(
                      'Previous messages have been summarized',
                    );

                    // Get messages for thread 2
                    getThreads({ graphId: testGraphId })
                      .then((threadsRes) => {
                        const thread2InternalId = threadsRes.body.find(
                          (t) => t.externalThreadId === thread2Id,
                        )?.id;
                        return getThreadMessages(thread2InternalId!);
                      })
                      .then((messagesResponse2) => {
                        expect(messagesResponse2.status).to.equal(200);
                        expect(messagesResponse2.body).to.be.an('array');
                        expect(messagesResponse2.body.length).to.be.greaterThan(
                          0,
                        );

                        const thread2Messages = messagesResponse2.body.map(
                          (m) => m.message,
                        );

                        // Check for system message indicating summarization occurred
                        // With multiple messages and aggressive summarization settings, summarization should occur
                        const summarySystemMessage2 = thread2Messages.find(
                          (msg) =>
                            msg.role === 'system' &&
                            typeof msg.content === 'string' &&
                            msg.content.includes('Summary updated'),
                        );
                        expect(summarySystemMessage2).to.exist;
                        expect(summarySystemMessage2?.content).to.include(
                          'Previous messages have been summarized',
                        );

                        // Verify messages are isolated - thread 1 should not contain thread 2's message
                        const thread1ContainsThread2Message =
                          thread1Messages.some(
                            (msg) => msg.content === thread2Message,
                          );
                        expect(thread1ContainsThread2Message).to.be.false;

                        // Verify messages are isolated - thread 2 should not contain thread 1's message
                        const thread2ContainsThread1Message =
                          thread2Messages.some(
                            (msg) => msg.content === thread1Message,
                          );
                        expect(thread2ContainsThread1Message).to.be.false;

                        // Clean up the test graph
                        destroyGraph(testGraphId).then(() => {
                          deleteGraph(testGraphId);
                        });
                      });
                  });
              });
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
            return getThreadByExternalId(triggerResponse.body.threadId);
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

            return getThreadByExternalId(triggerResponse.body.threadId);
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
  });
});
