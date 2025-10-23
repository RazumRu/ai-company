import { reqHeaders } from '../common.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  destroyGraph,
  executeTrigger,
  getNodeMessages,
  runGraph,
} from './graphs.helper';

describe('Graph Node Messages E2E', () => {
  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('GET /v1/graphs/:graphId/nodes/:nodeId/messages', () => {
    it('should retrieve messages for a node after execution', () => {
      const nodeId = 'agent-1';
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

          // Get messages using thread component
          return getNodeMessages(testGraphId, nodeId, {
            threadId: triggerResponse.body.threadId,
          });
        })
        .then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body).to.have.property('nodeId', nodeId);
          expect(response.body).to.have.property('threads');
          expect(response.body.threads).to.be.an('array');
          expect(response.body.threads.length).to.be.greaterThan(0);

          // Verify thread structure
          const firstThread = response.body.threads[0];
          expect(firstThread).to.have.property('id'); // threadId
          expect(firstThread).to.have.property('messages');
          expect(firstThread.messages).to.be.an('array');
          expect(firstThread.messages.length).to.be.greaterThan(0);

          // Verify our sent message is included
          const humanMessage = firstThread.messages.find(
            (msg) => msg.role === 'human',
          );
          expect(humanMessage).to.exist;
          expect(humanMessage.content).to.include(testMessage);

          // Verify message structure
          const firstMessage = firstThread.messages[0];
          expect(firstMessage).to.have.property('role');
          expect(firstMessage).to.have.property('content');

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should limit messages when limit parameter is provided', () => {
      const nodeId = 'agent-1';
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
          return getNodeMessages(testGraphId, nodeId, {
            threadId: triggerResponse.body.threadId,
            limit: 2,
          });
        })
        .then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body.threads).to.be.an('array');
          if (response.body.threads.length > 0) {
            const thread = response.body.threads[0];
            expect(thread.messages).to.be.an('array');
            expect(thread.messages.length).to.be.at.most(2);
          }

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentGraphId = '00000000-0000-0000-0000-000000000000';
      const nodeId = 'agent-1';

      getNodeMessages(
        nonExistentGraphId,
        nodeId,
        { threadId: 'any-thread' },
        reqHeaders,
      ).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 404 for non-existent node', () => {
      const nonExistentNodeId = 'non-existent-node';
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

          return getNodeMessages(
            testGraphId,
            nonExistentNodeId,
            { threadId: 'any-thread' },
            reqHeaders,
          );
        })
        .then((response) => {
          expect(response.status).to.equal(404);

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should include human and AI messages', () => {
      const nodeId = 'agent-1';
      const testQuestion = 'What is 2+2?';
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

          return executeTrigger(testGraphId, 'trigger-1', {
            messages: [testQuestion],
          });
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);

          return getNodeMessages(testGraphId, nodeId, {
            threadId: triggerResponse.body.threadId,
          });
        })
        .then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body.threads.length).to.be.greaterThan(0);

          const thread = response.body.threads[0];
          const messages = thread.messages;

          // Should have at least a human message and an AI response
          expect(messages).to.be.an('array');
          expect(messages.length).to.be.greaterThan(1);

          // Find and verify our sent message is included
          const humanMessage = messages.find((msg) => msg.role === 'human');
          expect(humanMessage).to.exist;
          expect(humanMessage.content).to.equal(testQuestion);

          // Find AI message (response should be present)
          const aiMessage = messages.find((msg) => msg.role === 'ai');
          expect(aiMessage).to.exist;
          expect(aiMessage.content).to.be.a('string');

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should persist messages across graph restarts', () => {
      const nodeId = 'agent-1';
      const testMessage = 'Message before restart';
      let testGraphId: string;
      let triggerResponse: any;
      let initialMessageCount: number;

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

          // Execute a trigger with custom threadId
          return executeTrigger(testGraphId, 'trigger-1', {
            messages: [testMessage],
            threadSubId: 'persist-test',
          });
        })
        .then((response) => {
          triggerResponse = response;
          expect(triggerResponse.status).to.equal(201);

          // Get the threadId from first execution
          return getNodeMessages(testGraphId, nodeId, {
            threadId: triggerResponse.body.threadId,
          });
        })
        .then((firstResponse) => {
          expect(firstResponse.status).to.equal(200);
          expect(firstResponse.body.threads.length).to.be.greaterThan(0);

          const firstThread = firstResponse.body.threads[0];
          initialMessageCount = firstThread.messages.length;
          expect(initialMessageCount).to.be.greaterThan(0);

          // Verify our sent message is in the first response
          const firstHumanMessage = firstThread.messages.find(
            (msg) => msg.role === 'human',
          );
          expect(firstHumanMessage).to.exist;
          expect(firstHumanMessage.content).to.equal(testMessage);

          // Stop and restart the graph
          return destroyGraph(testGraphId);
        })
        .then(() => {
          return runGraph(testGraphId);
        })
        .then(() => {
          // Get messages again with the same threadId component
          return getNodeMessages(testGraphId, nodeId, {
            threadId: triggerResponse.body.threadId,
          });
        })
        .then((secondResponse) => {
          expect(secondResponse.status).to.equal(200);
          expect(secondResponse.body.threads.length).to.be.greaterThan(0);

          const secondThread = secondResponse.body.threads[0];
          expect(secondThread.messages.length).to.equal(initialMessageCount);

          // Verify our sent message is still preserved after restart
          const humanMessage = secondThread.messages.find(
            (msg) => msg.role === 'human',
          );
          expect(humanMessage).to.exist;
          expect(humanMessage.content).to.equal(testMessage);

          // Cleanup
          destroyGraph(testGraphId).then(() => {
            deleteGraph(testGraphId);
          });
        });
    });

    it('should isolate messages between different threads', () => {
      const nodeId = 'agent-1';
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
            return getNodeMessages(testGraphId, nodeId, {
              threadId: `${testGraphId}:${thread1Component}`,
            })
              .then((messagesResponse1) => {
                expect(messagesResponse1.status).to.equal(200);
                expect(messagesResponse1.body.threads.length).to.be.greaterThan(
                  0,
                );

                const thread1 = messagesResponse1.body.threads[0];
                const thread1HumanMsg = thread1.messages.find(
                  (msg) => msg.role === 'human',
                );
                expect(thread1HumanMsg).to.exist;
                expect(thread1HumanMsg.content).to.equal(thread1Message);

                // Verify thread 2 message is NOT in thread 1
                const thread2MessageInThread1 = thread1.messages.find(
                  (msg) => msg.content === thread2Message,
                );
                expect(thread2MessageInThread1).to.not.exist;

                // Get messages for thread 2
                return getNodeMessages(testGraphId, nodeId, {
                  threadId: `${testGraphId}:${thread2Component}`,
                });
              })
              .then((messagesResponse2) => {
                expect(messagesResponse2.status).to.equal(200);
                expect(messagesResponse2.body.threads.length).to.be.greaterThan(
                  0,
                );

                const thread2 = messagesResponse2.body.threads[0];
                const thread2HumanMsg = thread2.messages.find(
                  (msg) => msg.role === 'human',
                );
                expect(thread2HumanMsg).to.exist;
                expect(thread2HumanMsg.content).to.equal(thread2Message);

                // Verify thread 1 message is NOT in thread 2
                const thread1MessageInThread2 = thread2.messages.find(
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
      const nodeId = 'agent-1';
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
                summarizeMaxTokens: 100, // Very low max tokens to force summarization
                summarizeKeepTokens: 50, // Very low keep tokens
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

          // Execute trigger for thread 1
          executeTrigger(testGraphId, 'trigger-1', {
            messages: [thread1Message],
            threadSubId: 'isolation-thread-1',
          }).then((response1) => {
            expect(response1.status).to.equal(201);
            expect(response1.body).to.have.property('threadId');
            const thread1Id = response1.body.threadId;

            // Execute trigger for thread 2
            executeTrigger(testGraphId, 'trigger-1', {
              messages: [thread2Message],
              threadSubId: 'isolation-thread-2',
            }).then((response2) => {
              expect(response2.status).to.equal(201);
              expect(response2.body).to.have.property('threadId');
              const thread2Id = response2.body.threadId;

              // Verify thread IDs are different
              expect(thread1Id).to.not.equal(thread2Id);

              // Get messages for thread 1
              getNodeMessages(testGraphId, nodeId, {
                threadId: thread1Id,
              }).then((messagesResponse1) => {
                expect(messagesResponse1.status).to.equal(200);
                expect(messagesResponse1.body.threads).to.be.an('array');
                expect(messagesResponse1.body.threads.length).to.be.greaterThan(
                  0,
                );

                const thread1 = messagesResponse1.body.threads[0];
                expect(thread1.id).to.equal(thread1Id);
                expect(thread1.messages).to.be.an('array');

                // Find the human message in thread 1
                const humanMessage1 = thread1.messages.find(
                  (msg) => msg.role === 'human',
                );
                expect(humanMessage1).to.exist;
                expect(humanMessage1.content).to.equal(thread1Message);

                // Get messages for thread 2
                getNodeMessages(testGraphId, nodeId, {
                  threadId: thread2Id,
                }).then((messagesResponse2) => {
                  expect(messagesResponse2.status).to.equal(200);
                  expect(messagesResponse2.body.threads).to.be.an('array');
                  expect(
                    messagesResponse2.body.threads.length,
                  ).to.be.greaterThan(0);

                  const thread2 = messagesResponse2.body.threads[0];
                  expect(thread2.id).to.equal(thread2Id);
                  expect(thread2.messages).to.be.an('array');

                  // Find the human message in thread 2
                  const humanMessage2 = thread2.messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(humanMessage2).to.exist;
                  expect(humanMessage2.content).to.equal(thread2Message);

                  // Verify messages are isolated - thread 1 should not contain thread 2's message
                  const thread1ContainsThread2Message = thread1.messages.some(
                    (msg) => msg.content === thread2Message,
                  );
                  expect(thread1ContainsThread2Message).to.be.false;

                  // Verify messages are isolated - thread 2 should not contain thread 1's message
                  const thread2ContainsThread1Message = thread2.messages.some(
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

    it('should preserve full message history with conservative summarization', () => {
      const nodeId = 'agent-1';
      const testMessage = 'What is the capital of France?';
      const followUpMessage = 'And what is the capital of Germany?';
      let testGraphId: string;

      // Create a graph with conservative summarization settings
      const graphData = {
        name: `Test Graph with Conservative Summarization ${Math.random().toString(36).slice(0, 8)}`,
        description: 'Test graph with conservative summarization settings',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent with Conservative Summarization',
                instructions:
                  'You are a helpful test agent. Please provide detailed responses to test summarization behavior.',
                invokeModelName: 'gpt-5-mini',
                summarizeMaxTokens: 8000, // High max tokens to avoid summarization
                summarizeKeepTokens: 2000, // High keep tokens
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

          // Execute first trigger
          executeTrigger(testGraphId, 'trigger-1', {
            messages: [testMessage],
            threadSubId: 'history-test-thread',
          }).then((response1) => {
            expect(response1.status).to.equal(201);
            const threadId = response1.body.threadId;

            // Wait a bit for processing
            cy.wait(2000);

            // Get messages after first execution
            getNodeMessages(testGraphId, nodeId, {
              threadId: threadId,
            }).then((messagesResponse1) => {
              expect(messagesResponse1.status).to.equal(200);
              const thread1 = messagesResponse1.body.threads[0];
              const messages1 = thread1.messages;

              // Verify we have the original human message
              const humanMessage = messages1.find(
                (msg) => msg.role === 'human',
              );
              expect(humanMessage).to.exist;
              expect(humanMessage.content).to.equal(testMessage);

              // Execute second trigger with same threadSubId (should continue conversation)
              executeTrigger(testGraphId, 'trigger-1', {
                messages: [followUpMessage],
                threadSubId: 'history-test-thread',
              }).then((response2) => {
                expect(response2.status).to.equal(201);
                // Should get the same thread ID since we used the same threadSubId
                expect(response2.body.threadId).to.equal(threadId);

                // Wait a bit for processing
                cy.wait(2000);

                // Get messages after second execution
                getNodeMessages(testGraphId, nodeId, {
                  threadId: threadId,
                }).then((messagesResponse2) => {
                  expect(messagesResponse2.status).to.equal(200);
                  const thread2 = messagesResponse2.body.threads[0];
                  const messages2 = thread2.messages;

                  // Verify we still have the original human message
                  const originalHumanMessage = messages2.find(
                    (msg) =>
                      msg.role === 'human' && msg.content === testMessage,
                  );
                  expect(originalHumanMessage).to.exist;

                  // Verify we have the follow-up human message
                  const followUpHumanMessage = messages2.find(
                    (msg) =>
                      msg.role === 'human' && msg.content === followUpMessage,
                  );
                  expect(followUpHumanMessage).to.exist;

                  // Verify we have more messages than before (conversation continued)
                  expect(messages2.length).to.be.greaterThan(messages1.length);

                  // Verify message order - original should come before follow-up
                  const originalIndex = messages2.findIndex(
                    (msg) => msg.content === testMessage,
                  );
                  const followUpIndex = messages2.findIndex(
                    (msg) => msg.content === followUpMessage,
                  );
                  expect(originalIndex).to.be.lessThan(followUpIndex);

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
});
