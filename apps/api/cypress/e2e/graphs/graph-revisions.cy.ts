import { inc as semverInc } from 'semver';

import { GraphDto } from '../../api-definitions';
import { graphCleanup } from './graph-cleanup.helper';
import {
  getGraphRevisions,
  waitForRevisionStatus,
} from './graph-revisions.helper';
import {
  createGraph,
  createMockGraphData,
  getGraphById,
  runGraph,
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
});
