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
  let testGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  describe('GET /v1/graphs/:graphId/nodes/:nodeId/messages', () => {
    beforeEach(() => {
      // Create and run a test graph
      const graphData = createMockGraphData();
      createGraph(graphData)
        .then((response) => {
          testGraphId = response.body.id;
          return runGraph(testGraphId);
        })
        .then(() => {
          // Wait for graph to fully initialize
          cy.wait(2000);
        });
    });

    afterEach(() => {
      // Cleanup after each test
      destroyGraph(testGraphId);
      deleteGraph(testGraphId);
    });

    it('should retrieve messages for a node after execution', () => {
      const nodeId = 'agent-1';
      const testMessage = 'Hello, test agent!';

      // Execute a trigger to create some messages
      executeTrigger(testGraphId, 'trigger-1', {
        messages: [testMessage],
      }).then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        expect(triggerResponse.body).to.have.property('threadId');
        expect(triggerResponse.body).to.have.property('checkpointNs');

        // Extract thread component from full threadId (format: graphId:threadComponent)
        const fullThreadId = triggerResponse.body.threadId;
        const threadComponent = fullThreadId.split(':')[1];
        expect(threadComponent).to.exist;

        // Get messages using thread component
        getNodeMessages(testGraphId, nodeId, {
          threadId: threadComponent,
        }).then((response) => {
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
        });
      });
    });

    it('should return empty threads for node with no executions', () => {
      const nodeId = 'agent-1';
      const nonExistentThread = 'non-existent-thread';

      getNodeMessages(testGraphId, nodeId, {
        threadId: nonExistentThread,
      }).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('threads');
        expect(response.body.threads).to.be.an('array');
        expect(response.body.threads).to.have.length(0);
      });
    });

    it('should limit messages when limit parameter is provided', () => {
      const nodeId = 'agent-1';

      // Execute to create messages with custom threadId
      executeTrigger(testGraphId, 'trigger-1', {
        messages: ['Test message with multiple interactions'],
        threadId: 'limit-test-thread',
      }).then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        const threadComponent = triggerResponse.body.threadId.split(':')[1];

        // Get messages with limit
        getNodeMessages(testGraphId, nodeId, {
          threadId: threadComponent,
          limit: 2,
        }).then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body.threads).to.be.an('array');
          if (response.body.threads.length > 0) {
            const thread = response.body.threads[0];
            expect(thread.messages).to.be.an('array');
            expect(thread.messages.length).to.be.at.most(2);
          }
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

      getNodeMessages(
        testGraphId,
        nonExistentNodeId,
        { threadId: 'any-thread' },
        reqHeaders,
      ).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should include human and AI messages', () => {
      const nodeId = 'agent-1';
      const testQuestion = 'What is 2+2?';

      executeTrigger(testGraphId, 'trigger-1', {
        messages: [testQuestion],
      }).then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        const threadComponent = triggerResponse.body.threadId.split(':')[1];

        getNodeMessages(testGraphId, nodeId, {
          threadId: threadComponent,
        }).then((response) => {
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
        });
      });
    });

    it('should persist messages across graph restarts', () => {
      const nodeId = 'agent-1';
      const testMessage = 'Message before restart';

      // Execute a trigger with custom threadId
      executeTrigger(testGraphId, 'trigger-1', {
        messages: [testMessage],
        threadId: 'persist-test',
      }).then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        const threadComponent = triggerResponse.body.threadId.split(':')[1];

        // Get the threadId from first execution
        getNodeMessages(testGraphId, nodeId, {
          threadId: threadComponent,
        }).then((firstResponse) => {
          expect(firstResponse.status).to.equal(200);
          expect(firstResponse.body.threads.length).to.be.greaterThan(0);

          const firstThread = firstResponse.body.threads[0];
          const initialMessageCount = firstThread.messages.length;
          expect(initialMessageCount).to.be.greaterThan(0);

          // Verify our sent message is in the first response
          const firstHumanMessage = firstThread.messages.find(
            (msg) => msg.role === 'human',
          );
          expect(firstHumanMessage).to.exist;
          expect(firstHumanMessage.content).to.equal(testMessage);

          // Stop and restart the graph
          destroyGraph(testGraphId).then(() => {
            runGraph(testGraphId).then(() => {
              // Get messages again with the same threadId component
              getNodeMessages(testGraphId, nodeId, {
                threadId: threadComponent,
              }).then((secondResponse) => {
                expect(secondResponse.status).to.equal(200);
                expect(secondResponse.body.threads.length).to.be.greaterThan(0);

                const secondThread = secondResponse.body.threads[0];
                expect(secondThread.messages.length).to.equal(
                  initialMessageCount,
                );

                // Verify our sent message is still preserved after restart
                const humanMessage = secondThread.messages.find(
                  (msg) => msg.role === 'human',
                );
                expect(humanMessage).to.exist;
                expect(humanMessage.content).to.equal(testMessage);
              });
            });
          });
        });
      });
    });

    it('should isolate messages between different threads', () => {
      const nodeId = 'agent-1';
      const thread1Message = 'Message for thread 1';
      const thread2Message = 'Message for thread 2';

      // Execute trigger for thread 1
      executeTrigger(testGraphId, 'trigger-1', {
        messages: [thread1Message],
        threadId: 'thread-1',
      }).then((response1) => {
        expect(response1.status).to.equal(201);
        const thread1Component = response1.body.threadId.split(':')[1];

        // Execute trigger for thread 2
        executeTrigger(testGraphId, 'trigger-1', {
          messages: [thread2Message],
          threadId: 'thread-2',
        }).then((response2) => {
          expect(response2.status).to.equal(201);
          const thread2Component = response2.body.threadId.split(':')[1];

          // Get messages for thread 1
          getNodeMessages(testGraphId, nodeId, {
            threadId: thread1Component,
          }).then((messagesResponse1) => {
            expect(messagesResponse1.status).to.equal(200);
            expect(messagesResponse1.body.threads.length).to.be.greaterThan(0);

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
            getNodeMessages(testGraphId, nodeId, {
              threadId: thread2Component,
            }).then((messagesResponse2) => {
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
            });
          });
        });
      });
    });

    it('should not retrieve messages from one thread when querying another', () => {
      const nodeId = 'agent-1';
      const threadAMessage = 'Message for thread A';

      // Execute trigger for thread A
      executeTrigger(testGraphId, 'trigger-1', {
        messages: [threadAMessage],
        threadId: 'thread-a',
      }).then((responseA) => {
        expect(responseA.status).to.equal(201);

        // Try to get messages for thread B (which doesn't exist)
        getNodeMessages(testGraphId, nodeId, {
          threadId: 'thread-b',
        }).then((responseB) => {
          expect(responseB.status).to.equal(200);
          expect(responseB.body.threads).to.be.an('array');
          expect(responseB.body.threads).to.have.length(0);
        });
      });
    });
  });
});
