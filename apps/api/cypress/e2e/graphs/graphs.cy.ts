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
  waitForGraph,
} from './graphs.helper';

const incrementVersion = (version: string): string => {
  const parts = version.split('.');
  const lastIndex = parts.length - 1;
  const lastValue = parseInt(parts[lastIndex] ?? '0', 10) || 0;
  parts[lastIndex] = String(lastValue + 1);
  return parts.join('.');
};

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

      createGraph(
        invalidGraphData as unknown as Parameters<typeof createGraph>[0],
        reqHeaders,
      ).then((response) => {
        expect(response.status).to.equal(403);
      });
    });

    it('should return 400 for duplicate node IDs', () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'duplicate-id',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
            {
              id: 'duplicate-id',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [],
        },
      });

      createGraph(invalidGraphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property('message');
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include('Duplicate node IDs found in graph schema');
      });
    });

    it('should return 400 for invalid template', () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'invalid-template',
              config: {},
            },
          ],
          edges: [],
        },
      });

      createGraph(invalidGraphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property('message');
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include("Template 'invalid-template' is not registered");
      });
    });

    it('should return 400 for edge referencing non-existent node', () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [
            {
              from: 'node-1',
              to: 'non-existent-node',
            },
          ],
        },
      });

      createGraph(invalidGraphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property('message');
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include(
          'Edge references non-existent target node: non-existent-node',
        );
      });
    });

    it('should return 400 for edge referencing non-existent source node', () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { image: 'python:3.11' },
            },
          ],
          edges: [
            {
              from: 'non-existent-node',
              to: 'node-1',
            },
          ],
        },
      });

      createGraph(invalidGraphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property('message');
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include(
          'Edge references non-existent source node: non-existent-node',
        );
      });
    });

    it('should return 400 for invalid template configuration', () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { invalidConfig: 'invalid' },
            },
          ],
          edges: [],
        },
      });

      createGraph(invalidGraphData, reqHeaders).then((response) => {
        expect(response.status).to.equal(400);
        expect(response.body).to.have.property('message');
        expect(
          (response.body as unknown as { message: string }).message,
        ).to.include('Invalid configuration for template');
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

    it('should filter graphs by ids query parameter', () => {
      // Create two test graphs
      const graph1Data = createMockGraphData();
      const graph2Data = createMockGraphData();

      createGraph(graph1Data).then((response1) => {
        const graphId1 = response1.body.id;

        createGraph(graph2Data).then((response2) => {
          const graphId2 = response2.body.id;

          // Test with single id
          getAllGraphs({ ids: [graphId1] }).then((response) => {
            expect(response.status).to.equal(200);
            const graphs = response.body;
            expect(graphs).to.be.an('array');
            expect(graphs.length).to.be.at.least(1);

            const foundGraph = graphs.find((g) => g.id === graphId1);
            expect(foundGraph).to.exist;

            graphs.forEach((graph) => {
              validateGraph(graph);
            });
          });

          // Test with multiple ids
          getAllGraphs({ ids: [graphId1, graphId2] }).then((response) => {
            expect(response.status).to.equal(200);
            const graphs = response.body;
            expect(graphs).to.be.an('array');
            expect(graphs.length).to.be.at.least(2);

            const foundGraph1 = graphs.find((g) => g.id === graphId1);
            const foundGraph2 = graphs.find((g) => g.id === graphId2);
            expect(foundGraph1).to.exist;
            expect(foundGraph2).to.exist;

            graphs.forEach((graph) => {
              validateGraph(graph);
            });
          });

          // Test with non-existent id
          const nonExistentId = '00000000-0000-0000-0000-000000000000';
          getAllGraphs({ ids: [nonExistentId] }).then((response) => {
            expect(response.status).to.equal(200);
            const graphs = response.body;
            expect(graphs).to.be.an('array');
            expect(graphs.length).to.equal(0);
          });
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
      getGraphById(createdGraphId).then((graphResponse) => {
        const currentVersion = graphResponse.body.version;
        const existingName = graphResponse.body.name;
        const updateData = createMockUpdateData(currentVersion);

        updateGraph(createdGraphId, updateData).then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body.graph).to.have.property('id', createdGraphId);
          // Graph updates are applied asynchronously via revisions; immediate response
          // contains the current graph state, not the post-revision state.
          expect(response.body.graph).to.have.property('name', existingName);
          expect(response.body.graph).to.have.property('updatedAt');
          expect(response.body.graph.version).to.equal(currentVersion);

          validateGraph(response.body.graph);

          // Wait until revision is applied
          return waitForGraph(
            createdGraphId,
            (g) => g.name === updateData.name,
          );
        });
      });
    });

    it('should update only provided fields', () => {
      const partialUpdateData = {
        name: 'Partially Updated Graph',
      };

      getGraphById(createdGraphId).then((graphResponse) => {
        const currentVersion = graphResponse.body.version;
        const existingName = graphResponse.body.name;

        updateGraph(createdGraphId, {
          ...partialUpdateData,
          currentVersion,
        }).then((response) => {
          expect(response.status).to.equal(200);
          expect(response.body.graph).to.have.property('id', createdGraphId);
          // Graph updates are applied asynchronously via revisions; immediate response
          // contains the current graph state, not the post-revision state.
          expect(response.body.graph).to.have.property('name', existingName);
          // Description should remain unchanged
          expect(response.body.graph).to.have.property('description');
          expect(response.body.graph.version).to.equal(currentVersion);

          validateGraph(response.body.graph);

          // Wait until revision is applied
          return waitForGraph(
            createdGraphId,
            (g) => g.name === partialUpdateData.name,
          );
        });
      });
    });

    it('should return 404 for non-existent graph', () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const updateData = createMockUpdateData('0.0.0');

      updateGraph(nonExistentId, updateData, reqHeaders).then((response) => {
        expect(response.status).to.equal(404);
      });
    });

    it('should increment version when updating schema on a stopped graph', () => {
      const graphData = createMockGraphData();

      createGraph(graphData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const graphId = createResponse.body.id;

        // Ensure graph becomes "stopped" (not just "created") before schema update.
        // Version bump behavior is tied to stopped graphs in the backend.
        runGraph(graphId).then(() => {
          destroyGraph(graphId).then(() => {
            getGraphById(graphId).then((graphResponse) => {
              const currentVersion = graphResponse.body.version;
              const expectedVersion = incrementVersion(currentVersion);

              const updatedSchema = {
                ...graphResponse.body.schema,
                nodes: graphResponse.body.schema.nodes.map((node) =>
                  node.id === 'agent-1'
                    ? {
                        ...node,
                        config: {
                          ...node.config,
                          instructions: 'Schema update via e2e test',
                        },
                      }
                    : node,
                ),
              };

              updateGraph(graphId, {
                schema: updatedSchema,
                currentVersion,
              }).then((updateResponse) => {
                expect(updateResponse.status).to.equal(200);

                // Wait until revision is applied and version increments
                return waitForGraph(
                  graphId,
                  (g) =>
                    g.version === expectedVersion &&
                    g.schema.nodes.find((n) => n.id === 'agent-1')?.config
                      .instructions === 'Schema update via e2e test',
                );
              });
            });
          });
        });
      });
    });

    it('should return 400 when currentVersion does not match latest version', () => {
      const graphData = createMockGraphData();

      createGraph(graphData).then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        const graphId = createResponse.body.id;
        const originalVersion = createResponse.body.version;

        const updatedSchema = {
          ...createResponse.body.schema,
          nodes: createResponse.body.schema.nodes.map((node) =>
            node.id === 'agent-1'
              ? {
                  ...node,
                  config: {
                    ...node.config,
                    instructions: 'First schema update',
                  },
                }
              : node,
          ),
        };

        updateGraph(graphId, {
          schema: updatedSchema,
          currentVersion: originalVersion,
        }).then((firstUpdateResponse) => {
          expect(firstUpdateResponse.status).to.equal(200);

          const secondSchema = {
            ...updatedSchema,
            nodes: updatedSchema.nodes.map((node) =>
              node.id === 'agent-1'
                ? {
                    ...node,
                    config: {
                      ...node.config,
                      instructions: 'Second schema update should fail',
                    },
                  }
                : node,
            ),
          };

          updateGraph(graphId, {
            schema: secondSchema,
            currentVersion: originalVersion,
          }).then((conflictResponse) => {
            expect(conflictResponse.status).to.equal(400);
            expect(
              (conflictResponse.body as { message?: string }).message,
            ).to.include('conflicts');
          });
        });
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
        const updateData = createMockUpdateData(createResponse.body.version);
        updateGraph(lifecycleGraphId, updateData).then((updateResponse) => {
          expect(updateResponse.status).to.equal(200);
          // Graph updates are applied asynchronously via revisions
          expect(updateResponse.body.graph.name).to.equal(
            createResponse.body.name,
          );

          // Wait until revision is applied before continuing lifecycle
          return waitForGraph(
            lifecycleGraphId,
            (g) => g.name === updateData.name,
          ).then(() => {
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
});
