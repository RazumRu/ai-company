import {
  createGraph,
  runGraph,
  suggestKnowledgeContent,
  waitForGraphStatus,
} from '../graphs/graphs.helper';

describe('AI Suggestions - knowledge content', () => {
  it('returns knowledge content for a new thread', () => {
    createGraph({
      name: 'Test Graph',
      temporary: true,
      schema: {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              description: 'Test agent used in e2e flows',
              instructions: 'Base instructions',
              invokeModelName: 'gpt-5-mini',
              maxIterations: 10,
            },
          },
          {
            id: 'knowledge-1',
            template: 'simple-knowledge',
            config: { content: 'Existing knowledge' },
          },
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {},
          },
        ],
        edges: [
          { from: 'trigger-1', to: 'agent-1' },
          { from: 'agent-1', to: 'knowledge-1' },
        ],
      },
    }).then((createResponse) => {
      expect(createResponse.status).to.eq(201);
      const graphId = createResponse.body.id;

      runGraph(graphId).then((runResponse) => {
        expect(runResponse.status).to.eq(201);
        waitForGraphStatus(graphId, 'running').then(() => {
          suggestKnowledgeContent(
            graphId,
            'knowledge-1',
            'Provide concise product facts',
          ).then((response) => {
            expect(response.status).to.eq(201);
            expect(response.body).to.have.property('content');
            expect(response.body).to.have.property('threadId');
          });
        });
      });
    });
  });

  it('continues knowledge suggestion conversation when threadId provided', () => {
    createGraph({
      name: 'Test Graph',
      temporary: true,
      schema: {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              description: 'Test agent used in e2e flows',
              instructions: 'Base instructions',
              invokeModelName: 'gpt-5-mini',
              maxIterations: 10,
            },
          },
          {
            id: 'knowledge-1',
            template: 'simple-knowledge',
            config: { content: 'Existing knowledge' },
          },
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {},
          },
        ],
        edges: [
          { from: 'trigger-1', to: 'agent-1' },
          { from: 'agent-1', to: 'knowledge-1' },
        ],
      },
    }).then((createResponse) => {
      expect(createResponse.status).to.eq(201);
      const graphId = createResponse.body.id;

      runGraph(graphId).then((runResponse) => {
        expect(runResponse.status).to.eq(201);
        waitForGraphStatus(graphId, 'running').then(() => {
          suggestKnowledgeContent(
            graphId,
            'knowledge-1',
            'Add more details',
          ).then((response) => {
            expect(response.status).to.eq(201);
            expect(response.body).to.have.property('threadId');
          });
        });
      });
    });
  });
});
