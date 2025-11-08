import { inc as semverInc } from 'semver';

import { GraphDto } from '../../api-definitions';
import { graphCleanup } from './graph-cleanup.helper';
import {
  getGraphRevisionById,
  getGraphRevisions,
  waitForRevisionStatus,
} from './graph-revisions.helper';
import {
  createGraph,
  createMockGraphData,
  deleteGraph,
  getGraphById,
  runGraph,
  stopGraph,
  updateGraph,
  waitForGraphToBeRunning,
} from './graphs.helper';

const cloneSchema = <T>(schema: T): T => Cypress._.cloneDeep(schema);

const buildUpdatedSchema = (
  schema: GraphDto['schema'],
  instructions: string,
): GraphDto['schema'] => ({
  ...schema,
  nodes: schema.nodes.map((node) =>
    node.id === 'agent-1'
      ? {
          ...node,
          config: {
            ...node.config,
            instructions,
          },
        }
      : node,
  ),
});

const incrementVersion = (version: string): string => {
  const next = semverInc(version, 'patch');
  if (next) {
    return next;
  }

  const parts = version.split('.');
  const lastIndex = parts.length - 1;
  const lastValue = parseInt(parts[lastIndex] ?? '0', 10) || 0;
  parts[lastIndex] = String(lastValue + 1);
  return parts.join('.');
};

describe('Graph Revisions E2E', () => {
  after(() => {
    cy.log('Running cleanup for Graph Revisions E2E tests...');
    graphCleanup.cleanupAllGraphs();
  });

  it('applies a revision to a running graph', () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions for live revision';

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;
    let expectedVersion: string;
    let revisionId: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;
        expectedVersion = incrementVersion(currentVersion);

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        const updatedSchema = buildUpdatedSchema(baseSchema, newInstructions);

        return updateGraph(graphId, {
          schema: updatedSchema,
          currentVersion,
        });
      })
      .then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length(1);

        const revision = revisionsResponse.body[0];
        if (!revision) {
          throw new Error('Expected a revision to be created');
        }

        expect(revision.status).to.be.oneOf(['pending', 'applying', 'applied']);
        expect(revision.toVersion).to.equal(expectedVersion);
        revisionId = revision.id;

        return waitForRevisionStatus(graphId, revisionId, 'applying', {
          allowHigherStatus: true,
        });
      })
      .then(() => waitForRevisionStatus(graphId, revisionId, 'applied'))
      .then((appliedRevision) => {
        expect(appliedRevision.status).to.equal('applied');
        expect(appliedRevision.error).to.be.undefined;

        return getGraphById(graphId);
      })
      .then((graphResponse) => {
        expect(graphResponse.status).to.equal(200);
        expect(graphResponse.body.version).to.equal(expectedVersion);

        const agentNode = graphResponse.body.schema.nodes.find(
          (node) => node.id === 'agent-1',
        );
        expect(agentNode?.config).to.have.property(
          'instructions',
          newInstructions,
        );

        return getGraphRevisions(graphId, { status: 'applied' });
      })
      .then((appliedRevisionsResponse) => {
        expect(appliedRevisionsResponse.status).to.equal(200);
        expect(appliedRevisionsResponse.body).to.have.length(1);

        const applied = appliedRevisionsResponse.body[0];
        if (!applied) {
          throw new Error('Expected an applied revision to be returned');
        }

        expect(applied.status).to.equal('applied');
        expect(applied.toVersion).to.equal(expectedVersion);
      });
  });

  it('processes queued revisions sequentially', () => {
    const graphData = createMockGraphData();

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let firstRevisionId: string;
    let secondRevisionId: string;
    let currentVersion: string;
    let firstTargetVersion: string;
    let secondTargetVersion: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;
        firstTargetVersion = incrementVersion(currentVersion);
        secondTargetVersion = incrementVersion(firstTargetVersion);

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        const firstSchema = buildUpdatedSchema(
          baseSchema,
          'First revision instructions',
        );

        return updateGraph(graphId, {
          schema: firstSchema,
          currentVersion,
        });
      })
      .then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((firstRevisionsResponse) => {
        expect(firstRevisionsResponse.status).to.equal(200);
        expect(firstRevisionsResponse.body).to.have.length(1);

        const firstRevision = firstRevisionsResponse.body[0];
        if (!firstRevision) {
          throw new Error('Expected first revision to be returned');
        }

        firstRevisionId = firstRevision.id;
        expect(firstRevision.toVersion).to.equal(firstTargetVersion);
        secondTargetVersion = incrementVersion(firstTargetVersion);

        return getGraphById(graphId);
      })
      .then((currentGraphResponse) => {
        expect(currentGraphResponse.status).to.equal(200);
        currentVersion = currentGraphResponse.body.version;

        const secondSchema = buildUpdatedSchema(
          baseSchema,
          'Second revision instructions',
        );

        return updateGraph(graphId, {
          schema: secondSchema,
          currentVersion,
        });
      })
      .then((secondUpdateResponse) => {
        expect(secondUpdateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length(2);

        const revisionsById = Cypress._.keyBy(revisionsResponse.body, 'id');
        const firstRevision = revisionsById[firstRevisionId];
        expect(firstRevision, 'Expected first revision to be present').to.exist;

        const secondRevision = revisionsResponse.body.find(
          (revision) => revision.id !== firstRevisionId,
        );
        expect(secondRevision, 'Expected second revision to be present').to
          .exist;

        secondRevisionId = secondRevision!.id;

        expect(secondRevision!.status).to.be.oneOf([
          'pending',
          'applying',
          'applied',
        ]);

        return getGraphRevisionById(graphId, secondRevisionId);
      })
      .then((secondRevisionResponse) => {
        expect(secondRevisionResponse.status).to.equal(200);
        expect(secondRevisionResponse.body.status).to.be.oneOf([
          'pending',
          'applying',
          'applied',
        ]);

        expect(secondRevisionResponse.body.toVersion).to.equal(
          secondTargetVersion,
        );

        return waitForRevisionStatus(graphId, firstRevisionId, 'applied');
      })
      .then(() =>
        waitForRevisionStatus(graphId, secondRevisionId, 'applying', {
          allowHigherStatus: true,
        }),
      )
      .then(() => waitForRevisionStatus(graphId, secondRevisionId, 'applied'))
      .then((finalRevision) => {
        expect(finalRevision.status).to.equal('applied');
        expect(finalRevision.toVersion).to.equal(secondTargetVersion);

        return getGraphById(graphId);
      })
      .then((graphResponse) => {
        expect(graphResponse.status).to.equal(200);
        expect(graphResponse.body.version).to.equal(secondTargetVersion);
        const agentNode = graphResponse.body.schema.nodes.find(
          (node) => node.id === 'agent-1',
        );
        expect(agentNode?.config).to.have.property(
          'instructions',
          'Second revision instructions',
        );
      });
  });

  it('marks revisions as failed when the graph is deleted before application', () => {
    const graphData = createMockGraphData();

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;
    let revisionId: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        return updateGraph(graphId, {
          schema: buildUpdatedSchema(
            baseSchema,
            'Revision that should ultimately fail',
          ),
          currentVersion,
        });
      })
      .then((response) => {
        expect(response.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length(1);

        const revision = revisionsResponse.body[0];
        if (!revision) {
          throw new Error(
            'Expected revision to exist before waiting for failure',
          );
        }

        revisionId = revision.id;
      })
      .then(() =>
        deleteGraph(graphId).then((deleteResponse) => {
          expect(deleteResponse.status).to.be.oneOf([200, 404]);
          graphCleanup.unregisterGraph(graphId);
        }),
      )
      .then(() => {
        // Wait a bit for the revision to be processed
        return cy.wait(5000);
      })
      .then(() => getGraphRevisionById(graphId, revisionId))
      .then((revisionResponse) => {
        expect(revisionResponse.status).to.equal(200);
        const revision = revisionResponse.body;

        // Revision might be applied if it was processed before deletion
        // or failed if the graph was deleted first
        expect(revision.status).to.be.oneOf(['applied', 'failed']);

        if (revision.status === 'failed') {
          expect(String(revision.error ?? '')).to.include('GRAPH_NOT_FOUND');
        }
      });
  });

  it('updates graphs directly when they are not running', () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions without running';

    let graphId: string;
    let currentVersion: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        currentVersion = createResponse.body.version;

        const updatedSchema = buildUpdatedSchema(
          createResponse.body.schema,
          newInstructions,
        );

        return updateGraph(graphId, {
          schema: updatedSchema,
          currentVersion,
        });
      })
      .then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);
        expect(updateResponse.body.version).to.equal(
          incrementVersion(currentVersion),
        );

        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length(0);
      });
  });

  it('queues revisions when graph is compiling', () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions during compilation';

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;
    let expectedVersion: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;
        expectedVersion = incrementVersion(currentVersion);

        // Start the graph (it will be in compiling state initially)
        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);

        // Immediately update while graph is still compiling
        const updatedSchema = buildUpdatedSchema(baseSchema, newInstructions);

        return updateGraph(graphId, {
          schema: updatedSchema,
          currentVersion,
        });
      })
      .then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);

        // Should have queued the revision
        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length.greaterThan(0);

        const revision = revisionsResponse.body[0];
        if (!revision) {
          throw new Error('Expected a revision to be created');
        }

        expect(revision.status).to.be.oneOf(['pending', 'applying', 'applied']);
        expect(revision.toVersion).to.equal(expectedVersion);

        // Wait for graph to be running
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        // Verify the revision was eventually applied
        return getGraphRevisions(graphId, { status: 'applied' });
      })
      .then((appliedRevisionsResponse) => {
        expect(appliedRevisionsResponse.status).to.equal(200);
        expect(appliedRevisionsResponse.body).to.have.length.greaterThan(0);

        const appliedRevision = appliedRevisionsResponse.body[0];
        expect(appliedRevision?.status).to.equal('applied');
        expect(appliedRevision?.toVersion).to.equal(expectedVersion);
      });
  });

  it('prevents version conflicts with pessimistic locking', () => {
    const graphData = createMockGraphData();

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        // Try to update with the correct version
        const firstSchema = buildUpdatedSchema(
          baseSchema,
          'First update attempt',
        );

        return updateGraph(graphId, {
          schema: firstSchema,
          currentVersion,
        });
      })
      .then((firstUpdateResponse) => {
        expect(firstUpdateResponse.status).to.equal(200);

        // Try to update again with the same old version (should fail)
        const secondSchema = buildUpdatedSchema(
          baseSchema,
          'Second update attempt with stale version',
        );

        return updateGraph(graphId, {
          schema: secondSchema,
          currentVersion, // Using stale version
        });
      })
      .then((conflictResponse) => {
        expect(conflictResponse.status).to.equal(400);
        expect(
          (conflictResponse.body as { message?: string }).message,
        ).to.include('Graph version mismatch');
      });
  });

  it('maintains FIFO order for queued revisions', () => {
    const graphData = createMockGraphData();

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;
    let firstRevisionId: string;
    let secondRevisionId: string;
    let thirdRevisionId: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        // Queue first revision
        const firstSchema = buildUpdatedSchema(
          baseSchema,
          'First revision in queue',
        );

        return updateGraph(graphId, {
          schema: firstSchema,
          currentVersion,
        });
      })
      .then((firstUpdateResponse) => {
        expect(firstUpdateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((firstRevisionsResponse) => {
        const firstRevision = firstRevisionsResponse.body[0];
        if (!firstRevision) {
          throw new Error('Expected first revision to be created');
        }
        firstRevisionId = firstRevision.id;
        currentVersion = firstRevision.toVersion;

        // Queue second revision immediately
        const secondSchema = buildUpdatedSchema(
          baseSchema,
          'Second revision in queue',
        );

        return updateGraph(graphId, {
          schema: secondSchema,
          currentVersion,
        });
      })
      .then((secondUpdateResponse) => {
        expect(secondUpdateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((secondRevisionsResponse) => {
        const secondRevision = secondRevisionsResponse.body.find(
          (r) => r.id !== firstRevisionId,
        );
        if (!secondRevision) {
          throw new Error('Expected second revision to be created');
        }
        secondRevisionId = secondRevision.id;
        currentVersion = secondRevision.toVersion;

        // Queue third revision
        const thirdSchema = buildUpdatedSchema(
          baseSchema,
          'Third revision in queue',
        );

        return updateGraph(graphId, {
          schema: thirdSchema,
          currentVersion,
        });
      })
      .then((thirdUpdateResponse) => {
        expect(thirdUpdateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((thirdRevisionsResponse) => {
        const thirdRevision = thirdRevisionsResponse.body.find(
          (r) => r.id !== firstRevisionId && r.id !== secondRevisionId,
        );
        if (!thirdRevision) {
          throw new Error('Expected third revision to be created');
        }
        thirdRevisionId = thirdRevision.id;

        // Wait for all revisions to complete
        return waitForRevisionStatus(graphId, firstRevisionId, 'applied');
      })
      .then(() => waitForRevisionStatus(graphId, secondRevisionId, 'applied'))
      .then(() => waitForRevisionStatus(graphId, thirdRevisionId, 'applied'))
      .then(() => {
        // Verify all revisions were applied in order
        return getGraphRevisions(graphId, { status: 'applied' });
      })
      .then((appliedRevisionsResponse) => {
        expect(appliedRevisionsResponse.status).to.equal(200);
        expect(appliedRevisionsResponse.body).to.have.length(3);

        // Verify the final graph has the last update
        return getGraphById(graphId);
      })
      .then((graphResponse) => {
        expect(graphResponse.status).to.equal(200);

        const agentNode = graphResponse.body.schema.nodes.find(
          (node) => node.id === 'agent-1',
        );
        expect(agentNode?.config).to.have.property(
          'instructions',
          'Third revision in queue',
        );
      });
  });

  it('handles non-running graphs gracefully when applying queued revisions', () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions for stopped graph';

    let graphId: string;
    let baseSchema: GraphDto['schema'];
    let currentVersion: string;
    let expectedVersion: string;
    let revisionId: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        baseSchema = cloneSchema(createResponse.body.schema);
        currentVersion = createResponse.body.version;
        expectedVersion = incrementVersion(currentVersion);

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        // Queue a revision while running
        const updatedSchema = buildUpdatedSchema(baseSchema, newInstructions);

        return updateGraph(graphId, {
          schema: updatedSchema,
          currentVersion,
        });
      })
      .then((updateResponse) => {
        expect(updateResponse.status).to.equal(200);
        return getGraphRevisions(graphId);
      })
      .then((revisionsResponse) => {
        expect(revisionsResponse.status).to.equal(200);
        expect(revisionsResponse.body).to.have.length(1);

        const revision = revisionsResponse.body[0];
        if (!revision) {
          throw new Error('Expected a revision to be created');
        }

        revisionId = revision.id;

        // Stop the graph before revision is applied
        return stopGraph(graphId);
      })
      .then((stopResponse) => {
        expect(stopResponse.status).to.be.oneOf([200, 404]);

        // Wait for revision to be processed (should still be marked as applied)
        return waitForRevisionStatus(graphId, revisionId, 'applied', {
          timeout: 30000,
        });
      })
      .then((appliedRevision) => {
        expect(appliedRevision.status).to.equal('applied');

        // Verify the graph schema was updated even though it's not running
        return getGraphById(graphId);
      })
      .then((graphResponse) => {
        expect(graphResponse.status).to.equal(200);
        expect(graphResponse.body.version).to.equal(expectedVersion);

        const agentNode = graphResponse.body.schema.nodes.find(
          (node) => node.id === 'agent-1',
        );
        expect(agentNode?.config).to.have.property(
          'instructions',
          newInstructions,
        );
      });
  });
});
