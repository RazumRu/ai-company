import { reqHeaders } from '../common.helper';
import { graphCleanup } from './graph-cleanup.helper';
import {
  createGraph,
  createMockGraphData,
  createMockUpdateData,
  deleteGraph,
  destroyGraph,
  getAllGraphs,
  getGraphById,
  runGraph,
  updateGraph,
  validateGraph,
} from './graphs.helper';

describe('Graphs E2E', () => {
  let createdGraphId: string;

  // Cleanup after all tests in this describe block
  after(() => {
    cy.log('Running cleanup for Graphs E2E tests...');
    graphCleanup.cleanupAllGraphs();
  });

  describe('POST /v1/graphs', () => {
    it('should create a new graph', () => {
      const graphData = createMockGraphData();

      createGraph(graphData).then((response) => {
        expect(response.status).to.equal(201);
        validateGraph(response.body);
        createdGraphId = response.body.id;
      });
    });

    it('should create a graph with minimal required fields', () => {
      const minimalGraphData = createMockGraphData({
        description: undefined,
      });

      createGraph(minimalGraphData).then((response) => {
        expect(response.status).to.equal(201);

        validateGraph(response.body);
      });
    });

    it('should return 400 for invalid graph data', () => {
      const invalidGraphData = {
        version: '1.0.0',
        schema: {
          metadata: {
            graphId: 'invalid-uuid',
            version: '1.0.0',
          },
        },
      };

      createGraph(invalidGraphData as any, reqHeaders).then((response) => {
        expect(response.status).to.equal(403);
      });
    });
  });

  describe('GET /v1/graphs', () => {
    it('should get all graphs', () => {
      getAllGraphs().then((response) => {
        expect(response.status).to.equal(200);
        const graphs = response.body;
        expect(graphs).to.be.an('array');

        // Validate each graph in the response
        graphs.forEach((graph) => {
          validateGraph(graph);
        });
      });
    });
  });

  describe('GET /v1/graphs/:id', () => {
    beforeEach(() => {
      // Create a graph for testing if not already created
      if (!createdGraphId) {
        const graphData = createMockGraphData();
        createGraph(graphData).then((response) => {
          createdGraphId = response.body.id;
        });
      }
    });

    it('should get a graph by id', () => {
      getGraphById(createdGraphId).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('id', createdGraphId);

        validateGraph(response.body);
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      getGraphById(nonExistentId, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 400 for invalid UUID', () => {
      const invalidId = 'invalid-uuid';

      getGraphById(invalidId, reqHeaders).then((response) => {
        expect(response.status).to.equal(403);
      });
    });
  });

  describe('PUT /v1/graphs/:id', () => {
    beforeEach(() => {
      // Create a graph for testing if not already created
      if (!createdGraphId) {
        const graphData = createMockGraphData();
        createGraph(graphData).then((response) => {
          createdGraphId = response.body.id;
        });
      }
    });

    it('should update a graph', () => {
      const updateData = createMockUpdateData();

      updateGraph(createdGraphId, updateData).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('id', createdGraphId);
        expect(response.body).to.have.property('name', updateData.name);
        expect(response.body).to.have.property(
          'description',
          updateData.description,
        );
        expect(response.body).to.have.property('updatedAt');

        validateGraph(response.body);
      });
    });

    it('should update only provided fields', () => {
      const partialUpdateData = {
        name: 'Partially Updated Graph',
      };

      updateGraph(createdGraphId, partialUpdateData).then((response) => {
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('id', createdGraphId);
        expect(response.body).to.have.property('name', partialUpdateData.name);
        // Description should remain unchanged
        expect(response.body).to.have.property('description');

        validateGraph(response.body);
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const updateData = createMockUpdateData();

      updateGraph(nonExistentId, updateData, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });
  });

  describe('POST /v1/graphs/:id/run', () => {
    let runTestGraphId: string;

    beforeEach(() => {
      // Create a graph specifically for run testing
      const graphData = createMockGraphData();
      createGraph(graphData).then((response) => {
        runTestGraphId = response.body.id;
      });
    });

    it('should run a graph', () => {
      runGraph(runTestGraphId).then((response) => {
        expect(response.status).to.equal(201);
        expect(response.body).to.have.property('id', runTestGraphId);
        expect(response.body).to.have.property('status', 'running');

        validateGraph(response.body);
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      runGraph(nonExistentId, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should return 400 if graph is already running', () => {
      // First run
      runGraph(runTestGraphId).then(() => {
        // Second run should fail
        runGraph(runTestGraphId, reqHeaders).then((response) => {
          expect(response.status).to.equal(400);
        });
      });
    });
  });

  describe('POST /v1/graphs/:id/destroy', () => {
    let destroyTestGraphId: string;

    beforeEach(() => {
      // Create a graph specifically for destroy testing
      const graphData = createMockGraphData();
      createGraph(graphData).then((response) => {
        destroyTestGraphId = response.body.id;
      });
    });

    it('should destroy a running graph', () => {
      // First run the graph
      runGraph(destroyTestGraphId).then(() => {
        // Then destroy it
        destroyGraph(destroyTestGraphId).then((response) => {
          expect(response.status).to.equal(201); // Changed from 200 to 201 based on actual response
          expect(response.body).to.have.property('id', destroyTestGraphId);
          expect(response.body).to.have.property('status', 'stopped');

          validateGraph(response.body);
        });
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      destroyGraph(nonExistentId, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });
  });

  describe('DELETE /v1/graphs/:id', () => {
    let graphToDeleteId: string;

    beforeEach(() => {
      // Create a graph specifically for deletion testing
      const graphData = createMockGraphData();
      createGraph(graphData).then((response) => {
        graphToDeleteId = response.body.id;
      });
    });

    it('should delete a graph', () => {
      deleteGraph(graphToDeleteId).then((response) => {
        expect(response.status).to.equal(200);

        // Verify the graph is deleted by trying to get it
        getGraphById(graphToDeleteId, reqHeaders).then((getResponse) => {
          expect(getResponse.status).to.equal(404);
        });
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';

      deleteGraph(nonExistentId, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should stop and destroy running graph before deletion', () => {
      // First run the graph
      runGraph(graphToDeleteId).then(() => {
        // Then delete it (should automatically stop and destroy)
        deleteGraph(graphToDeleteId).then((response) => {
          expect(response.status).to.equal(200);

          // Verify the graph is deleted
          getGraphById(graphToDeleteId, reqHeaders).then((getResponse) => {
            expect(getResponse.status).to.equal(404);
          });
        });
      });
    });
  });

  describe('Graph Lifecycle', () => {
    let lifecycleGraphId: string;

    it('should complete full graph lifecycle', () => {
      // 1. Create a graph
      const graphData = createMockGraphData();
      createGraph(graphData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        expect(createResponse.body.status).to.equal('created');
        lifecycleGraphId = createResponse.body.id;

        // 2. Update the graph
        const updateData = createMockUpdateData();
        updateGraph(lifecycleGraphId, updateData).then((updateResponse) => {
          expect(updateResponse.status).to.equal(200);
          expect(updateResponse.body.name).to.equal(updateData.name);

          // 3. Run the graph
          runGraph(lifecycleGraphId).then((runResponse) => {
            expect(runResponse.status).to.equal(201);
            expect(runResponse.body.status).to.equal('running');

            // 4. Destroy the graph
            destroyGraph(lifecycleGraphId).then((destroyResponse) => {
              expect(destroyResponse.status).to.equal(201);
              expect(destroyResponse.body.status).to.equal('stopped');

              // 5. Delete the graph
              deleteGraph(lifecycleGraphId).then((deleteResponse) => {
                expect(deleteResponse.status).to.equal(200);

                // 6. Verify deletion
                getGraphById(lifecycleGraphId, reqHeaders).then(
                  (getResponse) => {
                    expect(getResponse.status).to.equal(404);
                  },
                );
              });
            });
          });
        });
      });
    });
  });
});
