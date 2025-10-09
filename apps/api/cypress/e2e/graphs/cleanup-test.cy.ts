import { reqHeaders } from '../common.helper';
import {
  createGraph,
  createMockGraphData,
  getGraphById,
} from './graphs.helper';
import { graphCleanup } from './graph-cleanup.helper';

describe('Graph Cleanup Test', () => {
  it('should automatically clean up created graphs', () => {
    // Create a test graph
    const graphData = createMockGraphData();
    
    createGraph(graphData).then((response) => {
      expect(response.status).to.equal(201);
      const graphId = response.body.id;
      
      // Verify the graph exists
      getGraphById(graphId).then((getResponse) => {
        expect(getResponse.status).to.equal(200);
        expect(getResponse.body.id).to.equal(graphId);
        
        // Verify the graph is registered for cleanup
        const registeredGraphs = graphCleanup.getRegisteredGraphs();
        expect(registeredGraphs).to.include(graphId);
        
        // Manually trigger cleanup to test the functionality
        graphCleanup.cleanupAllGraphs();
        
        // Verify the graph is deleted
        getGraphById(graphId, reqHeaders).then((deleteResponse) => {
          expect(deleteResponse.status).to.equal(404);
        });
      });
    });
  });

  // Cleanup after this test
  after(() => {
    cy.log('Running cleanup for cleanup test...');
    graphCleanup.cleanupAllGraphs();
  });
});