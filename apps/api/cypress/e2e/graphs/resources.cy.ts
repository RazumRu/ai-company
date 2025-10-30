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

describe('Resource System E2E', () => {
  let createdGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    cy.log('Running cleanup for Resource System E2E tests...');
    graphCleanup.cleanupAllGraphs();
  });

  describe('GitHub Resource Integration', () => {
    it('should create and run a graph with GitHub resource and shell tool', () => {
      // Use a mock token for testing
      const githubToken = 'mock-token-for-testing';

      const graphData: CreateGraphDto = {
        name: `GitHub Resource Test ${Date.now()}`,
        description: 'Test graph with GitHub resource and shell tool',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
                image: 'node:18',
              },
            },
            {
              id: 'github-resource-1',
              template: 'github-resource',
              config: {
                patToken: githubToken,
                auth: false,
              },
            },
            {
              id: 'shell-tool-1',
              template: 'shell-tool',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'GitHub Test Agent',
                instructions:
                  'You are a helpful agent with access to GitHub CLI. Use the shell tool to interact with GitHub.',
                invokeModelName: 'gpt-5-mini',
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
            {
              from: 'agent-1',
              to: 'shell-tool-1',
            },
            {
              from: 'shell-tool-1',
              to: 'runtime-1',
            },
            {
              from: 'shell-tool-1',
              to: 'github-resource-1',
            },
          ],
        },
      };

      // Create the graph
      createGraph(graphData)
        .then((response) => {
          expect(response.status).to.equal(201);
          expect(response.body).to.have.property('id');
          createdGraphId = response.body.id;

          validateGraph(response.body);

          return runGraph(createdGraphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);

          return executeTrigger(createdGraphId, 'trigger-1', {
            messages: [
              'Please run "gh version" to check if GitHub CLI is installed.',
            ],
          });
        })
        .then((response) => {
          expect(response.status).to.equal(201);
          return getThreadByExternalId(response.body.threadId);
        })
        .then((threadRes) => {
          expect(threadRes.status).to.equal(200);
          const internalThreadId = threadRes.body.id;
          return getThreadMessages(internalThreadId);
        })
        .then((response) => {
          expect(response.status).to.equal(200);

          const messages = response.body.map((m) => m.message);
          expect(messages.length).to.be.greaterThan(0);

          const shellMessage = messages.find(
            (msg) =>
              msg.role === 'tool-shell' &&
              (msg as unknown as { name: string })['name'] === 'shell',
          );
          expect(shellMessage).to.exist;

          const shellContent = (shellMessage as unknown as { content: unknown })
            .content;
          expect(shellContent).to.be.an('object');
          expect(shellContent).to.have.property('exitCode').that.is.a('number');
          expect(shellContent).to.have.property('stdout').that.is.a('string');
          expect(shellContent).to.have.property('stderr').that.is.a('string');

          expect(shellContent)
            .to.have.property('stdout')
            .that.includes('gh version');
        });
    });

    it('should validate resource connections in graph schema', () => {
      // Test with invalid resource connection (non-existent resource node)
      const invalidGraphData: CreateGraphDto = {
        name: `Invalid Resource Test ${Date.now()}`,
        description: 'Test graph with invalid resource connection',
        version: '1.0.0',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
                image: 'node:18',
              },
            },
            {
              id: 'shell-tool-1',
              template: 'shell-tool',
              config: {},
            },
          ],
          edges: [
            {
              from: 'runtime-1',
              to: 'shell-tool-1',
            },
            {
              from: 'shell-tool-1',
              to: 'non-existent-resource', // Invalid resource reference
            },
          ],
        },
      };

      // This should fail validation
      createGraph(invalidGraphData).then((response) => {
        expect(response.status).to.equal(400);
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include('non-existent target node');
      });
    });
  });
});
