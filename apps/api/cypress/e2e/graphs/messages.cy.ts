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
        expect(triggerResponse.status).to.equal(204);

        // Wait for the agent to process and save checkpoint
        cy.wait(20000);

        // Get messages
        getNodeMessages(testGraphId, nodeId).then((response) => {
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

      getNodeMessages(testGraphId, nodeId).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('threads');
        expect(response.body.threads).to.be.an('array');
        expect(response.body.threads).to.have.length(0);
      });
    });

    it('should limit messages when limit parameter is provided', () => {
      const nodeId = 'agent-1';

      // Execute multiple times to create more messages
      executeTrigger(testGraphId, 'trigger-1', {
        messages: ['First message'],
      }).then(() => {
        cy.wait(2000);

        executeTrigger(testGraphId, 'trigger-1', {
          messages: ['Second message'],
        }).then(() => {
          cy.wait(20000);

          // Get messages with limit
          getNodeMessages(testGraphId, nodeId, { limit: 2 }).then(
            (response) => {
              expect(response.status).to.equal(200);
              expect(response.body.threads).to.be.an('array');
              if (response.body.threads.length > 0) {
                const thread = response.body.threads[0];
                expect(thread.messages).to.be.an('array');
                expect(thread.messages.length).to.be.at.most(2);
              }
            },
          );
        });
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentGraphId = '00000000-0000-0000-0000-000000000000';
      const nodeId = 'agent-1';

      getNodeMessages(nonExistentGraphId, nodeId, undefined, reqHeaders).then(
        (response) => {
          expect(response.status).to.equal(404);
        },
      );
    });

    it('should return 404 for non-existent node', () => {
      const nonExistentNodeId = 'non-existent-node';

      getNodeMessages(
        testGraphId,
        nonExistentNodeId,
        undefined,
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
      }).then(() => {
        cy.wait(20000);

        getNodeMessages(testGraphId, nodeId).then((response) => {
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

      // Execute a trigger
      executeTrigger(testGraphId, 'trigger-1', {
        messages: [testMessage],
      }).then(() => {
        cy.wait(20000);

        // Get the threadId from first execution
        getNodeMessages(testGraphId, nodeId).then((firstResponse) => {
          expect(firstResponse.status).to.equal(200);
          expect(firstResponse.body.threads.length).to.be.greaterThan(0);

          const firstThread = firstResponse.body.threads[0];
          const threadId = firstThread.id;
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
              // Get messages again with the same threadId
              getNodeMessages(testGraphId, nodeId, { threadId }).then(
                (secondResponse) => {
                  expect(secondResponse.status).to.equal(200);
                  expect(secondResponse.body.threads.length).to.be.greaterThan(
                    0,
                  );

                  const secondThread = secondResponse.body.threads[0];
                  expect(secondThread.id).to.equal(threadId);
                  expect(secondThread.messages.length).to.equal(
                    initialMessageCount,
                  );

                  // Verify our sent message is still preserved after restart
                  const humanMessage = secondThread.messages.find(
                    (msg) => msg.role === 'human',
                  );
                  expect(humanMessage).to.exist;
                  expect(humanMessage.content).to.equal(testMessage);
                },
              );
            });
          });
        });
      });
    });
  });
});
