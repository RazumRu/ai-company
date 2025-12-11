import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  runGraph,
  suggestAgentInstructions,
  waitForGraphStatus,
} from './graphs.helper';

describe('Graph agent instructions suggestion (E2E)', () => {
  after(() => {
    graphCleanup.cleanupAllGraphs();
  });

  it('suggests instructions for a non-running graph', () => {
    const graphData = createMockGraphData();

    createGraph(graphData).then((response) => {
      expect(response.status).to.equal(201);
      const graphId = response.body.id;

      suggestAgentInstructions(graphId, 'agent-1', 'Make it concise').then(
        (suggestionResponse) => {
          expect(suggestionResponse.status).to.equal(400);
        },
      );
    });
  });

  it('suggests instructions for a running graph', () => {
    const graphData = createMockGraphData();

    createGraph(graphData).then((createResponse) => {
      expect(createResponse.status).to.equal(201);
      const graphId = createResponse.body.id;

      runGraph(graphId).then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        waitForGraphStatus(graphId, 'running', undefined, 120000).then(() => {
          suggestAgentInstructions(
            graphId,
            'agent-1',
            'Add safety guidelines',
          ).then((suggestionResponse) => {
            expect(suggestionResponse.status).to.equal(201);
            expect(suggestionResponse.body.instructions).to.be.a('string');
            expect(
              suggestionResponse.body.instructions.length,
            ).to.be.greaterThan(0);
          });
        });
      });
    });
  });
});
