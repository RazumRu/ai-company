import { reqHeaders } from '../common.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  destroyGraph,
  executeTrigger,
  runGraph,
} from './graphs.helper';

describe('MCP Integration E2E', () => {
  let createdGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    cy.log('Running cleanup for MCP Integration E2E tests...');
    graphCleanup.cleanupAllGraphs();
  });

  describe('Graph with Filesystem MCP', () => {
    it('should create a graph with filesystem MCP node', () => {
      const graphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
              },
            },
            {
              id: 'mcp-1',
              template: 'filesystem-mcp',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'test-agent',
                description: 'Test agent with MCP',
                instructions:
                  'You are a helpful assistant with filesystem access.',
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
            { from: 'agent-1', to: 'mcp-1' },
            { from: 'mcp-1', to: 'runtime-1' },
            { from: 'trigger-1', to: 'agent-1' },
          ],
        },
      });

      createGraph(graphData).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('id');
        createdGraphId = response.body.id;
      });
    });

    it('should run the graph successfully', () => {
      cy.wrap(null).then(() => {
        if (!createdGraphId) {
          throw new Error('Graph ID not set');
        }

        runGraph(createdGraphId)
          .then((response) => {
            expect(response.status).to.equal(201);
          })
          .then(() =>
            executeTrigger(
              createdGraphId,
              'trigger-1',
              {
                messages: [
                  'Hello, test the filesystem access (via MCP tools).',
                ],
                async: false,
              },
              reqHeaders,
            ),
          )
          .then((response) => {
            expect(response.status).to.equal(201);
            expect(response.body).to.have.property('externalThreadId');
          });
      });
    });

    it('should destroy the graph', () => {
      cy.wrap(null).then(() => {
        if (!createdGraphId) {
          throw new Error('Graph ID not set');
        }

        destroyGraph(createdGraphId).then((response) => {
          expect(response.status).to.equal(201);
        });
      });
    });
  });

  describe('MCP Configuration Validation', () => {
    it('should accept empty config', () => {
      const graphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
              },
            },
            {
              id: 'mcp-1',
              template: 'filesystem-mcp',
              config: {},
            },
          ],
          edges: [{ from: 'mcp-1', to: 'runtime-1' }],
        },
      });

      createGraph(graphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(201);
        // Clean up
        if (response.body?.id) {
          destroyGraph(response.body.id);
        }
      });
    });
  });
});
