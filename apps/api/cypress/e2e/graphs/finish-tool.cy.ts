import { CreateGraphDto } from '../../api-definitions';
import {
  getThreadByExternalId,
  getThreadMessages,
} from '../threads/threads.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  executeTrigger,
  runGraph,
  validateGraph,
} from './graphs.helper';

describe('Finish Tool E2E Tests', () => {
  let createdGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    cy.log('Running cleanup for Finish Tool E2E tests...');
    graphCleanup.cleanupAllGraphs();
  });

  describe('Agent with Finish Tool', () => {
    it('should call finish tool without additional system message', () => {
      const graphData: CreateGraphDto = {
        name: `Finish Tool Test ${Date.now()}`,
        description: 'Test graph with simple agent and finish tool',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions:
                  'You are a helpful assistant. When you need more information from the user, call the finish tool with needsMoreInfo set to true.',
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: true,
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

      // Create the graph
      createGraph(graphData)
        .then((response) => {
          if (response.status !== 201) {
            throw new Error(
              'Graph creation failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          createdGraphId = response.body.id;
          cy.log(`Created graph with ID: ${createdGraphId}`);

          // Validate the graph
          validateGraph(response.body);
          cy.log('Graph validation successful');

          // Run the graph
          return runGraph(createdGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.eq(201);
          cy.log('Graph started successfully');

          // Execute the trigger
          return executeTrigger(createdGraphId, 'trigger-1', {
            messages: ['What is your name?'],
          });
        })
        .then((response) => {
          if (response.status !== 201) {
            throw new Error(
              'Execute trigger failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const threadId = response.body.threadId;
          cy.log(`Created thread with ID: ${threadId}`);

          // Wait for the graph to complete
          cy.wait(5000);

          // Get internal thread ID
          return getThreadByExternalId(threadId);
        })
        .then((threadRes) => {
          expect(threadRes.status).to.eq(200);
          const internalThreadId = threadRes.body.id;
          cy.log(`Internal thread ID: ${internalThreadId}`);

          // Get thread messages
          return getThreadMessages(internalThreadId);
        })
        .then((response) => {
          if (response.status !== 200) {
            throw new Error(
              'Get thread messages failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const messages = response.body;

          // Find the finish tool call
          const finishToolMessage = messages.find(
            (msg) =>
              msg.message.role === 'tool' && msg.message.name === 'finish',
          );

          expect(finishToolMessage).to.exist;
          cy.log('Found finish tool call');

          // Get the tool response content (already an object)
          const toolContent = finishToolMessage!.message.content as {
            message: string;
            needsMoreInfo: boolean;
          };
          expect(toolContent).to.have.property('message');
          expect(toolContent).to.have.property('needsMoreInfo');
          expect(toolContent.needsMoreInfo).to.be.false; // Should be false for a simple question

          cy.log('Finish tool response contains correct structure');
        });
    });

    it('should call finish tool with needsMoreInfo when asking for more information', () => {
      const graphData: CreateGraphDto = {
        name: `Finish Tool Needs Info Test ${Date.now()}`,
        description: 'Test graph with simple agent asking for more info',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions:
                  'You are a helpful assistant. When you need more information from the user, call the finish tool with needsMoreInfo set to true and include your question in the message.',
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: true,
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

      // Create the graph
      createGraph(graphData)
        .then((response) => {
          if (response.status !== 201) {
            cy.log(
              'Graph creation failed:',
              JSON.stringify(response.body, null, 2),
            );
          }
          expect(response.status).to.eq(201);
          createdGraphId = response.body.id;
          cy.log(`Created graph with ID: ${createdGraphId}`);

          // Validate the graph
          validateGraph(response.body);
          cy.log('Graph validation successful');

          // Run the graph
          return runGraph(createdGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.eq(201);
          cy.log('Graph started successfully');

          // Execute the trigger with a vague question that should require more info
          return executeTrigger(createdGraphId, 'trigger-1', {
            messages: ['Help me with something'],
          });
        })
        .then((response) => {
          if (response.status !== 201) {
            throw new Error(
              'Execute trigger failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const threadId = response.body.threadId;
          cy.log(`Created thread with ID: ${threadId}`);

          // Wait for the graph to complete
          cy.wait(5000);

          // Get internal thread ID
          return getThreadByExternalId(threadId);
        })
        .then((threadRes) => {
          expect(threadRes.status).to.eq(200);
          const internalThreadId = threadRes.body.id;
          cy.log(`Internal thread ID: ${internalThreadId}`);

          // Get thread messages
          return getThreadMessages(internalThreadId);
        })
        .then((response) => {
          if (response.status !== 200) {
            throw new Error(
              'Get thread messages failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const messages = response.body;

          // Find the finish tool call
          const finishToolMessage = messages.find(
            (msg) =>
              msg.message.role === 'tool' && msg.message.name === 'finish',
          );

          expect(finishToolMessage).to.exist;
          cy.log('Found finish tool call');

          // Get the tool response content (already an object)
          const toolContent = finishToolMessage!.message.content as {
            message: string;
            needsMoreInfo: boolean;
          };
          expect(toolContent).to.have.property('message');
          expect(toolContent).to.have.property('needsMoreInfo');
          expect(toolContent.needsMoreInfo).to.be.true; // Should be true when asking for more info

          // The message should provide clear follow-up instructions
          expect(toolContent.message.length).to.be.greaterThan(0);
          expect(toolContent.message.toLowerCase()).to.include('please');
          cy.log(
            'Finish tool response contains needsMoreInfo flag and question',
          );
        });
    });

    it('should not require additional system message to call finish tool', () => {
      const graphData: CreateGraphDto = {
        name: `Finish Tool No System Message Test ${Date.now()}`,
        description:
          'Test that agent calls finish tool without additional system prompts',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions:
                  'You are a helpful assistant. Always call the finish tool to end your response.',
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: true,
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

      // Create the graph
      createGraph(graphData)
        .then((response) => {
          if (response.status !== 201) {
            cy.log(
              'Graph creation failed:',
              JSON.stringify(response.body, null, 2),
            );
          }
          expect(response.status).to.eq(201);
          createdGraphId = response.body.id;
          cy.log(`Created graph with ID: ${createdGraphId}`);

          // Validate the graph
          validateGraph(response.body);
          cy.log('Graph validation successful');

          // Run the graph
          return runGraph(createdGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.eq(201);
          cy.log('Graph started successfully');

          // Execute the trigger
          return executeTrigger(createdGraphId, 'trigger-1', {
            messages: ['What is 2+2?'],
          });
        })
        .then((response) => {
          if (response.status !== 201) {
            throw new Error(
              'Execute trigger failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const threadId = response.body.threadId;
          cy.log(`Created thread with ID: ${threadId}`);

          // Wait for the graph to complete
          cy.wait(5000);

          // Get internal thread ID
          return getThreadByExternalId(threadId);
        })
        .then((threadRes) => {
          expect(threadRes.status).to.eq(200);
          const internalThreadId = threadRes.body.id;
          cy.log(`Internal thread ID: ${internalThreadId}`);

          // Get thread messages
          return getThreadMessages(internalThreadId);
        })
        .then((response) => {
          if (response.status !== 200) {
            throw new Error(
              'Get thread messages failed with status ' +
                response.status +
                ': ' +
                JSON.stringify(response.body, null, 2),
            );
          }
          const messages = response.body;

          // Check that there are no system messages about calling tools
          const systemMessages = messages.filter(
            (msg) =>
              msg.message.role === 'system' &&
              msg.message.content.includes('call a tool'),
          );

          expect(systemMessages).to.have.length(0);
          cy.log('No additional system messages found');

          // Find the finish tool call
          const finishToolMessage = messages.find(
            (msg) =>
              msg.message.role === 'tool' && msg.message.name === 'finish',
          );

          expect(finishToolMessage).to.exist;
          cy.log('Agent called finish tool without additional system prompts');
        });
    });
  });
});
