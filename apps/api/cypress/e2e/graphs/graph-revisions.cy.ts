import { inc as semverInc } from 'semver';

import {
  CreateGraphDto,
  GraphDto,
  GraphNodeWithStatusDto,
  GraphRevisionDto,
  ThreadDto,
  ThreadMessageDto,
} from '../../api-definitions';
import { reqHeaders } from '../common.helper';
import {
  getThreadByExternalId,
  getThreadMessages,
  waitForThreadStatus,
} from '../threads/threads.helper';
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
  executeTrigger,
  getCompiledNodes,
  getGraphById,
  runGraph,
  stopGraph,
  updateGraph,
  waitForGraphToBeRunning,
} from './graphs.helper';

const cloneSchema = <T>(schema: T): T => Cypress._.cloneDeep(schema);

const COMMAND_AGENT_INSTRUCTIONS =
  'You are a command runner. When the user message contains `Run this command: <cmd>` or `Execute shell command: <cmd>`, extract `<cmd>` and execute it exactly using the shell tool. Do not run any other commands, inspections, or tests unless the user explicitly requests them. After running the shell tool, call the finish tool with the stdout (and stderr if present). If the runtime is not yet started, wait briefly and retry once before reporting the failure.';

type ShellToolMessage = Extract<
  ThreadMessageDto['message'],
  { role: 'tool-shell' }
>;

type AiMessage = Extract<ThreadMessageDto['message'], { role: 'ai' }>;
type AiToolCall = AiMessage['toolCalls'] extends (infer T)[] ? T : never;

const isShellToolMessage = (
  message: ThreadMessageDto['message'] | undefined,
): message is ShellToolMessage => !!message && message.role === 'tool-shell';

const isAiMessage = (
  message: ThreadMessageDto['message'] | undefined,
): message is AiMessage => !!message && message.role === 'ai';

const terminalThreadStatuses: ThreadDto['status'][] = [
  'done',
  'need_more_info',
  'stopped',
];

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

const matchesShellCommand = (call: unknown, substring: string): boolean => {
  if (!call || typeof call !== 'object') {
    return false;
  }

  const { name, args } = call as {
    name?: unknown;
    args?: { cmd?: unknown };
  };

  if (name !== 'shell') {
    return false;
  }

  const command = args?.cmd;
  return typeof command === 'string' && command.includes(substring);
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
        if (secondUpdateResponse.status !== 200) {
          cy.task(
            'log',
            `[Queued Revisions Test] Second update failed: ${JSON.stringify(secondUpdateResponse.body, null, 2)}`,
          );
        }
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
        // Fetch the graph to get its updated version
        return getGraphById(graphId);
      })
      .then((graphResponse) => {
        // When queuing revisions, use the graph's actual current version
        currentVersion = graphResponse.body.version;
        return getGraphRevisions(graphId);
      })
      .then((firstRevisionsResponse) => {
        const firstRevision = firstRevisionsResponse.body[0];
        if (!firstRevision) {
          throw new Error('Expected first revision to be created');
        }
        firstRevisionId = firstRevision.id;

        // When a revision is pending, use its toVersion as the currentVersion for the next update
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

        // When a revision is pending, use its toVersion as the currentVersion for the next update
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

  describe('Edge Deletion and Node Changes', () => {
    it('marks revision as failed when removing required edge (trigger needs agent)', () => {
      const graphData = createMockGraphData();

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
          cy.task(
            'log',
            'Attempting to remove edge between trigger and agent (invalid)',
          );

          // Remove the edge from trigger to agent (this creates an invalid graph)
          const updatedSchema = cloneSchema(baseSchema);
          const initialEdgeCount = updatedSchema.edges?.length || 0;

          // Remove all edges (in our case, just the trigger->agent edge)
          if (updatedSchema.edges) {
            updatedSchema.edges = [];
          }

          const newEdgeCount = updatedSchema.edges?.length || 0;
          cy.task(
            'log',
            `Edges before: ${initialEdgeCount}, after: ${newEdgeCount}`,
          );

          expect(newEdgeCount).to.be.lessThan(initialEdgeCount);

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
          expect(revision.toVersion).to.equal(expectedVersion);

          // Wait for revision to be processed (will fail because trigger needs agent)
          return waitForRevisionStatus(graphId, revisionId, 'failed', {
            timeout: 30000,
          });
        })
        .then((failedRevision) => {
          expect(failedRevision.status).to.equal('failed');
          expect(failedRevision.error).to.include('No agent nodes found');

          cy.task(
            'log',
            'Revision correctly failed when removing required edge',
          );
        });
    });

    it('applies revision when re-adding the edge after removal', () => {
      const graphData = createMockGraphData();

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
          cy.task('log', 'First removing the edge, then will re-add it');

          // First, remove the edge
          const updatedSchema = cloneSchema(baseSchema);
          if (updatedSchema.edges) {
            updatedSchema.edges = [];
          }

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
          const firstRevision = revisionsResponse.body[0];
          if (!firstRevision) {
            throw new Error('Expected first revision to be created');
          }
          return waitForRevisionStatus(graphId, firstRevision.id, 'applied', {
            timeout: 30000,
          });
        })
        .then(() => getGraphById(graphId))
        .then((graphResponse) => {
          currentVersion = graphResponse.body.version;
          expectedVersion = incrementVersion(currentVersion);

          cy.task('log', 'Now re-adding the edge');

          // Re-add the original edge
          const updatedSchema = cloneSchema(baseSchema);

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
          const secondRevision = revisionsResponse.body.find(
            (r) => r.toVersion === expectedVersion,
          );
          if (!secondRevision) {
            throw new Error('Expected second revision to be created');
          }

          revisionId = secondRevision.id;

          return waitForRevisionStatus(graphId, revisionId, 'applied', {
            timeout: 30000,
          });
        })
        .then((appliedRevision) => {
          expect(appliedRevision.status).to.equal('applied');

          return getGraphById(graphId);
        })
        .then((graphResponse) => {
          expect(graphResponse.status).to.equal(200);
          expect(graphResponse.body.version).to.equal(expectedVersion);

          // Verify the edge is back
          expect(graphResponse.body.schema.edges).to.have.length(1);

          cy.task('log', 'Edge re-addition revision applied successfully');
        });
    });

    it('applies revision when changing agent model', () => {
      const graphData = createMockGraphData();

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
          cy.task('log', 'Changing agent model');

          const updatedSchema = cloneSchema(baseSchema);

          // Find and modify agent's model
          const agentNode = updatedSchema.nodes.find(
            (node) => node.id === 'agent-1',
          );

          if (agentNode) {
            agentNode.config = {
              ...agentNode.config,
              invokeModelName: 'gpt-4o',
            };
          }

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

          return waitForRevisionStatus(graphId, revisionId, 'applied', {
            timeout: 30000,
          });
        })
        .then((appliedRevision) => {
          expect(appliedRevision.status).to.equal('applied');

          return getGraphById(graphId);
        })
        .then((graphResponse) => {
          expect(graphResponse.status).to.equal(200);
          expect(graphResponse.body.version).to.equal(expectedVersion);

          // Verify the agent model was updated
          const updatedAgentNode = graphResponse.body.schema.nodes.find(
            (node) => node.id === 'agent-1',
          );

          expect(updatedAgentNode?.config).to.have.property(
            'invokeModelName',
            'gpt-4o',
          );

          cy.task('log', 'Agent model change applied successfully');
        });
    });
  });

  it('applies runtime updates and executes commands successfully', () => {
    const graphData: CreateGraphDto = {
      name: `Runtime Update Test ${Date.now()}`,
      description: 'Test runtime updates during live revision',
      temporary: true,
      schema: {
        nodes: [
          {
            id: 'trigger-1',
            template: 'manual-trigger',
            config: {},
          },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Shell Agent',
              instructions: COMMAND_AGENT_INSTRUCTIONS,
              invokeModelName: 'gpt-5-mini',
              enforceToolUsage: false,
              maxIterations: 10,
            },
          },
          {
            id: 'shell-1',
            template: 'shell-tool',
            config: {},
          },
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'python:3.11-slim',
              env: {
                TEST_VAR: 'original_value',
              },
            },
          },
        ],
        edges: [
          { from: 'trigger-1', to: 'agent-1' },
          { from: 'agent-1', to: 'shell-1' },
          { from: 'shell-1', to: 'runtime-1' },
        ],
      },
    };

    let graphId: string;
    let currentVersion: string;
    let threadId1: string;
    let threadId2: string;

    createGraph(graphData)
      .then((createResponse) => {
        expect(createResponse.status).to.equal(201);
        graphId = createResponse.body.id;
        currentVersion = createResponse.body.version;

        return runGraph(graphId);
      })
      .then((runResponse) => {
        expect(runResponse.status).to.equal(201);
        return waitForGraphToBeRunning(graphId);
      })
      .then(() => {
        return getCompiledNodes(graphId);
      })
      .then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(200);

        const runtimeNode = nodesResponse.body.find(
          (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
        );
        expect(runtimeNode).to.exist;
        expect(runtimeNode?.status).to.equal('idle');
      })
      .then(() => {
        return executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test1"'],
            async: false,
          },
          reqHeaders,
        );
      })
      .then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        threadId1 = triggerResponse.body.threadId;
        expect(threadId1).to.be.a('string').and.not.to.be.empty;

        return getCompiledNodes(graphId);
      })
      .then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(200);
        const runtimeNode = nodesResponse.body.find(
          (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
        );
        expect(runtimeNode).to.exist;
        expect(runtimeNode?.status).to.equal('idle');
      })
      .then(() => {
        const updatedSchema = cloneSchema(graphData.schema);
        const runtimeNode = updatedSchema.nodes.find(
          (n) => n.id === 'runtime-1',
        );
        if (runtimeNode) {
          runtimeNode.config = {
            ...runtimeNode.config,
            env: {
              TEST_VAR: 'updated_value',
            },
          };
        }

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
        expect(revision).to.exist;

        return waitForRevisionStatus(graphId, revision!.id, 'applied');
      })
      .then(() => {
        return getCompiledNodes(graphId);
      })
      .then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(200);
        const runtimeNode = nodesResponse.body.find(
          (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
        );
        expect(runtimeNode).to.exist;
        expect(runtimeNode?.status).to.equal('idle');
      })
      .then(() => {
        return executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Run this command: echo "test2"'],
            async: false,
          },
          reqHeaders,
        );
      })
      .then((triggerResponse) => {
        expect(triggerResponse.status).to.equal(201);
        threadId2 = triggerResponse.body.threadId;
        expect(threadId2).to.be.a('string').and.not.to.be.empty;
        expect(threadId2).to.not.equal(threadId1);

        return getCompiledNodes(graphId);
      })
      .then((nodesResponse) => {
        expect(nodesResponse.status).to.equal(200);
        const runtimeNode = nodesResponse.body.find(
          (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
        );
        expect(runtimeNode).to.exist;
        expect(runtimeNode?.status).to.equal('idle');
      });
  });

  describe('Live Revision Scenarios', () => {
    it.only('removes runtime node and agent can no longer use runtime commands', () => {
      const graphData: CreateGraphDto = {
        name: `Remove Runtime Test ${Date.now()}`,
        description: 'Test removing runtime during live revision',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Shell Agent',
                instructions: COMMAND_AGENT_INSTRUCTIONS,
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 10,
              },
            },
            {
              id: 'shell-1',
              template: 'shell-tool',
              config: {},
            },
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
                image: 'python:3.11-slim',
                env: {},
              },
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'shell-1' },
            { from: 'shell-1', to: 'runtime-1' },
          ],
        },
      };

      let graphId: string;
      let currentVersion: string;
      let threadId1: string;
      let internalThreadId1: string;

      createGraph(graphData)
        .then((createResponse) => {
          expect(createResponse.status).to.equal(201);
          graphId = createResponse.body.id;
          currentVersion = createResponse.body.version;

          return runGraph(graphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(graphId);
        })
        .then(() => {
          // Execute command with runtime BEFORE removing it
          return executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "test with runtime"'],
              async: false,
            },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          threadId1 = triggerResponse.body.threadId;

          // Wait for thread to complete (accepting any terminal status)
          return waitForThreadStatus(
            threadId1,
            terminalThreadStatuses,
            60,
            2000,
          );
        })
        .then((threadResponse) => {
          internalThreadId1 = threadResponse.body.id;
          return getThreadMessages(internalThreadId1);
        })
        .then((messagesResponse) => {
          expect(messagesResponse.status).to.equal(200);
          const messages = messagesResponse.body as ThreadMessageDto[];

          // Check that shell tool was called and succeeded
          const shellResults = messages
            .map((message: ThreadMessageDto) => message.message)
            .filter(isShellToolMessage);
          expect(shellResults.length).to.be.greaterThan(0);

          const successfulShell = shellResults.find(
            (message: ShellToolMessage) => message.content.exitCode === 0,
          );
          expect(successfulShell, 'Expected shell command to succeed').to.exist;

          // Check that we got output from the shell command
          const stdout = successfulShell?.content.stdout.toLowerCase() ?? '';
          expect(stdout).to.include('test with runtime');
        })
        .then(() => {
          // Create revision to remove runtime AND shell tool (since shell needs runtime)
          const updatedSchema = cloneSchema(graphData.schema);
          updatedSchema.nodes = updatedSchema.nodes.filter(
            (n) => n.id !== 'runtime-1' && n.id !== 'shell-1',
          );
          updatedSchema.edges = updatedSchema.edges!.filter(
            (e) => e.to !== 'runtime-1' && e.to !== 'shell-1',
          );

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
          const revision = revisionsResponse.body[0];
          expect(revision).to.exist;

          return waitForRevisionStatus(graphId, revision!.id, 'applied');
        })
        .then(() => {
          // Verify runtime and shell nodes are removed
          return getCompiledNodes(graphId);
        })
        .then((nodesResponse) => {
          expect(nodesResponse.status).to.equal(200);
          const runtimeNode = nodesResponse.body.find(
            (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
          );
          const shellNode = nodesResponse.body.find(
            (n: GraphNodeWithStatusDto) => n.id === 'shell-1',
          );
          expect(runtimeNode).to.not.exist;
          expect(shellNode).to.not.exist;
        })
        .then(() => {
          // Now try to execute a shell command WITHOUT runtime
          // The agent should fail since shell tool requires runtime
          return executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "test without runtime"'],
              async: false,
            },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          const threadId2 = triggerResponse.body.threadId;

          // Wait for thread to complete (should finish with stopped status due to errors)
          return waitForThreadStatus(
            threadId2,
            terminalThreadStatuses,
            60,
            2000,
          );
        })
        .then((threadResponse) => {
          // Thread should be marked as stopped when execution encounters errors
          expect(threadResponse.body.status).to.equal('stopped');

          const internalThreadId2 = threadResponse.body.id;

          // Check messages to verify agent couldn't use shell tool
          return getThreadMessages(internalThreadId2);
        })
        .then((messagesResponse) => {
          expect(messagesResponse.status).to.equal(200);
          const messages = messagesResponse.body as ThreadMessageDto[];

          // The agent should have attempted to execute but failed because:
          // 1. Shell tool is no longer available (removed with runtime), OR
          // 2. Agent reached max iterations trying to complete without the tool
          // The thread should have stopped with an error status
          const aiMessages = messages
            .map((m: ThreadMessageDto) => m.message)
            .filter(isAiMessage);

          // Verify the agent made at least some attempt
          expect(aiMessages.length).to.be.greaterThan(0);
        });
    });

    it('changes agent configuration and agent works with new config', () => {
      const graphData: CreateGraphDto = {
        name: `Agent Config Test ${Date.now()}`,
        description: 'Test agent configuration change during live revision',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions:
                  'You are a helpful agent. Always respond with "OLD CONFIG"',
                invokeModelName: 'gpt-5-mini',
                maxIterations: 10,
              },
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      let graphId: string;
      let currentVersion: string;

      createGraph(graphData)
        .then((createResponse) => {
          expect(createResponse.status).to.equal(201);
          graphId = createResponse.body.id;
          currentVersion = createResponse.body.version;

          return runGraph(graphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(graphId);
        })
        .then(() =>
          cy.wrap(new Promise((resolve) => setTimeout(resolve, 3000)), {
            timeout: 5000,
          }),
        )
        .then(() => {
          // Execute trigger with old config
          return executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Hello'],
              async: false,
            },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
        })
        .then(() => {
          // Change agent configuration
          const updatedSchema = cloneSchema(graphData.schema);
          const agentNode = updatedSchema.nodes.find((n) => n.id === 'agent-1');
          if (agentNode) {
            agentNode.config = {
              ...agentNode.config,
              instructions:
                'You are a helpful agent. Always respond with "NEW CONFIG"',
            };
          }

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
          const revision = revisionsResponse.body[0];
          expect(revision).to.exist;

          return waitForRevisionStatus(graphId, revision!.id, 'applied');
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 3000)), {
            timeout: 5000,
          });
        })
        .then(() => {
          // Verify agent node still exists
          return getCompiledNodes(graphId);
        })
        .then((nodesResponse) => {
          expect(nodesResponse.status).to.equal(200);
          const agentNode = nodesResponse.body.find(
            (n: GraphNodeWithStatusDto) => n.id === 'agent-1',
          );
          expect(agentNode).to.exist;
          expect(agentNode?.status).to.equal('idle');
        })
        .then(() => {
          // Execute trigger again with new config
          return executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Hello again'],
              async: false,
            },
            reqHeaders,
          );
        })
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
        });
    });

    it('adds new tool to agent and agent can use it', () => {
      const graphData: CreateGraphDto = {
        name: `Add Tool Test ${Date.now()}`,
        description: 'Test adding tool to agent during live revision',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: COMMAND_AGENT_INSTRUCTIONS,
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 10,
              },
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      };

      let graphId: string;
      let currentVersion: string;
      let threadId: string;
      let internalThreadId: string;

      createGraph(graphData)
        .then((createResponse) => {
          expect(createResponse.status).to.equal(201);
          graphId = createResponse.body.id;
          currentVersion = createResponse.body.version;

          return runGraph(graphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(graphId);
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 3000)), {
            timeout: 5000,
          });
        })
        .then(() => {
          // Add both shell tool and runtime in ONE revision (build order should handle dependencies)
          return cy
            .task(
              'log',
              `[Add Tool Test] Adding shell-1 and runtime-1 nodes to graph ${graphId}`,
            )
            .then(() => {
              const updatedSchema = cloneSchema(graphData.schema);
              updatedSchema.nodes.push({
                id: 'shell-1',
                template: 'shell-tool',
                config: {},
              });
              updatedSchema.nodes.push({
                id: 'runtime-1',
                template: 'docker-runtime',
                config: {
                  runtimeType: 'Docker',
                  image: 'python:3.11-slim',
                  env: {},
                },
              });
              updatedSchema.edges!.push({
                from: 'agent-1',
                to: 'shell-1',
              });
              updatedSchema.edges!.push({
                from: 'shell-1',
                to: 'runtime-1',
              });

              return updateGraph(graphId, {
                schema: updatedSchema,
                currentVersion,
              });
            });
        })
        .then((updateResponse) => {
          cy.task(
            'log',
            `[Add Tool Test] Update response status: ${updateResponse.status}`,
          );

          if (updateResponse.status !== 200) {
            cy.task(
              'log',
              `[Add Tool Test] Update error: ${JSON.stringify(updateResponse.body)}`,
            );
            expect(updateResponse.status).to.equal(200);
          }

          expect(updateResponse.status).to.equal(200);
          return getGraphRevisions(graphId);
        })
        .then((revisionsResponse) => {
          const response = revisionsResponse as Cypress.Response<
            GraphRevisionDto[]
          >;
          expect(response.status).to.equal(200);
          const revision = response.body[0];
          if (!revision) {
            throw new Error(
              '[Add Tool Test] Expected a revision to be returned after update',
            );
          }
          cy.task(
            'log',
            `[Add Tool Test] Revision created: ${revision.id}, status: ${revision.status}`,
          );
          return waitForRevisionStatus(graphId, revision.id, 'applied');
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 5000)), {
            timeout: 7000,
          });
        })
        .then(() => {
          // Verify both tools were added
          return cy
            .task('log', `[Add Tool Test] Getting compiled nodes`)
            .then(() => getCompiledNodes(graphId));
        })
        .then((nodesResponse) => {
          expect(nodesResponse.status).to.equal(200);
          return cy
            .task(
              'log',
              `[Add Tool Test] Compiled nodes: ${JSON.stringify(
                nodesResponse.body.map((node: GraphNodeWithStatusDto) => ({
                  id: node.id,
                  status: node.status,
                })),
              )}`,
            )
            .then(() => {
              const shellNode = nodesResponse.body.find(
                (n: GraphNodeWithStatusDto) => n.id === 'shell-1',
              );
              const runtimeNode = nodesResponse.body.find(
                (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
              );
              expect(shellNode).to.exist;
              expect(runtimeNode).to.exist;
            });
        })
        .then(() => {
          // Execute trigger to verify agent can use the tool
          return cy.task('log', `[Add Tool Test] Executing trigger`).then(() =>
            executeTrigger(
              graphId,
              'trigger-1',
              {
                messages: ['Run this command: echo "hello from new tool"'],
                async: true,
              },
              reqHeaders,
              60000,
            ),
          );
        })
        .then((triggerResponse) => {
          return cy
            .task(
              'log',
              `[Add Tool Test] Trigger response status: ${triggerResponse.status}`,
            )
            .then(() => {
              if (triggerResponse.status !== 201) {
                cy.task(
                  'log',
                  `[Add Tool Test] Trigger error: ${JSON.stringify(triggerResponse.body)}`,
                );
                throw new Error(
                  `[Add Tool Test] Expected trigger status 201 but received ${triggerResponse.status}`,
                );
              }
              expect(triggerResponse.status).to.equal(201);
              threadId = triggerResponse.body.threadId;
              cy.task('log', `[Add Tool Test] Thread ID: ${threadId}`);
              // Wait for thread to complete (accepting any terminal status)
              return waitForThreadStatus(
                threadId,
                terminalThreadStatuses,
                45,
                2000,
              );
            });
        })
        .then((threadResponse) => {
          internalThreadId = threadResponse.body.id;
          cy.task(
            'log',
            `[Add Tool Test] Thread status after waiting: ${JSON.stringify(threadResponse.body)}`,
          );
          return threadResponse;
        })
        .then(() => {
          // Verify the shell tool was used by checking messages (use internal UUID, not externalThreadId)
          cy.task(
            'log',
            `[Add Tool Test] Getting messages for thread: ${internalThreadId}`,
          );
          return getThreadMessages(internalThreadId);
        })
        .then((messagesResponse) => {
          cy.task(
            'log',
            `[Add Tool Test] Messages response status: ${messagesResponse.status}`,
          );
          if (messagesResponse.status !== 200) {
            cy.task(
              'log',
              `[Add Tool Test] Messages error: ${JSON.stringify(messagesResponse.body)}`,
            );
            throw new Error(
              `[Add Tool Test] Expected messages response status 200 but received ${messagesResponse.status}`,
            );
          }
          expect(messagesResponse.status).to.equal(200);
          const messages = messagesResponse.body as ThreadMessageDto[];
          cy.task(
            'log',
            `[Add Tool Test] Messages payload: ${JSON.stringify(messages, null, 2)}`,
          );

          // Check that shell tool was called and succeeded
          const shellResults = messages
            .map((message: ThreadMessageDto) => message.message)
            .filter(isShellToolMessage);
          cy.task(
            'log',
            `[Add Tool Test] Shell result count: ${shellResults.length}`,
          );
          expect(shellResults.length).to.be.greaterThan(0);

          const successfulShell = shellResults.find(
            (message: ShellToolMessage) => message.content.exitCode === 0,
          );
          expect(successfulShell, 'Expected shell command to succeed').to.exist;

          const correspondingCall = messages.find(
            (message: ThreadMessageDto) => {
              if (!isAiMessage(message.message)) {
                return false;
              }

              const toolCalls = (message.message.toolCalls ??
                []) as AiToolCall[];
              return toolCalls.some((call) =>
                matchesShellCommand(call, 'hello from new tool'),
              );
            },
          );
          expect(
            correspondingCall,
            'Expected shell tool call with the requested command',
          ).to.exist;

          // Check that we got output from the command
          const stdout = successfulShell?.content.stdout ?? '';
          expect(stdout).to.include('hello from new tool');
        });
    });

    it('changes tool configuration and it applies', () => {
      const graphData: CreateGraphDto = {
        name: `Tool Config Test ${Date.now()}`,
        description: 'Test tool configuration change during live revision',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: COMMAND_AGENT_INSTRUCTIONS,
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 10,
              },
            },
            {
              id: 'shell-1',
              template: 'shell-tool',
              config: {},
            },
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
                image: 'python:3.11-slim',
                env: {},
              },
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'shell-1' },
            { from: 'shell-1', to: 'runtime-1' },
          ],
        },
      };

      let graphId: string;
      let currentVersion: string;
      let threadId: string;
      let internalThreadId: string;

      createGraph(graphData)
        .then((createResponse) => {
          expect(createResponse.status).to.equal(201);
          graphId = createResponse.body.id;
          currentVersion = createResponse.body.version;

          return runGraph(graphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(graphId);
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 5000)), {
            timeout: 7000,
          });
        })
        .then(() => {
          // Update runtime env vars (since shell-tool has empty config)
          const updatedSchema = cloneSchema(graphData.schema);
          const runtimeNode = updatedSchema.nodes.find(
            (n) => n.id === 'runtime-1',
          );
          if (runtimeNode) {
            runtimeNode.config = {
              ...runtimeNode.config,
              env: {
                TEST_VAR: 'updated_value',
              },
            };
          }

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
          const revision = revisionsResponse.body[0];
          expect(revision).to.exist;

          return waitForRevisionStatus(graphId, revision!.id, 'applied');
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 3000)), {
            timeout: 5000,
          });
        })
        .then(() => {
          // Verify tool still exists
          return getCompiledNodes(graphId);
        })
        .then((nodesResponse) => {
          expect(nodesResponse.status).to.equal(200);
          const toolNode = nodesResponse.body.find(
            (n: GraphNodeWithStatusDto) => n.id === 'shell-1',
          );
          expect(toolNode).to.exist;
        })
        .then(() =>
          executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "test tool config"'],
              async: true,
            },
            reqHeaders,
            60000,
          ),
        )
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          threadId = triggerResponse.body.threadId;

          // Wait for thread to complete (accepting any terminal status)
          return waitForThreadStatus(
            threadId,
            terminalThreadStatuses,
            45,
            2000,
          );
        })
        .then((threadResponse) => {
          internalThreadId = threadResponse.body.id;
          cy.task(
            'log',
            `[Tool Config Test] Thread status: ${JSON.stringify(threadResponse.body)}`,
          );
          return threadResponse;
        })
        .then(() => {
          // Verify the tool still works by checking messages (use internal UUID, not externalThreadId)
          cy.task(
            'log',
            `[Tool Config Test] Getting messages for thread: ${internalThreadId}`,
          );
          return getThreadMessages(internalThreadId);
        })
        .then((messagesResponse) => {
          cy.task(
            'log',
            `[Tool Config Test] Messages response status: ${messagesResponse.status}`,
          );
          if (messagesResponse.status !== 200) {
            cy.task(
              'log',
              `[Tool Config Test] Messages error: ${JSON.stringify(messagesResponse.body)}`,
            );
            throw new Error(
              `[Tool Config Test] Expected messages response status 200 but received ${messagesResponse.status}`,
            );
          }
          expect(messagesResponse.status).to.equal(200);
          const messages = messagesResponse.body as ThreadMessageDto[];
          cy.task(
            'log',
            `[Tool Config Test] Messages payload: ${JSON.stringify(messages, null, 2)}`,
          );

          // Check that shell tool was called and succeeded
          const shellResults = messages
            .map((message: ThreadMessageDto) => message.message)
            .filter(isShellToolMessage);
          cy.task(
            'log',
            `[Tool Config Test] Shell result count: ${shellResults.length}`,
          );
          expect(shellResults.length).to.be.greaterThan(0);

          const successfulShell = shellResults.find(
            (message: ShellToolMessage) => message.content.exitCode === 0,
          );
          expect(successfulShell, 'Expected shell command to succeed').to.exist;

          const correspondingCall = messages.find(
            (message: ThreadMessageDto) => {
              if (!isAiMessage(message.message)) {
                return false;
              }

              const toolCalls = (message.message.toolCalls ??
                []) as AiToolCall[];
              return toolCalls.some((call) =>
                matchesShellCommand(call, 'test tool config'),
              );
            },
          );
          expect(
            correspondingCall,
            'Expected shell tool call with the requested command',
          ).to.exist;

          // Check that we got output from the command
          const stdout = successfulShell?.content.stdout ?? '';
          expect(stdout).to.include('test tool config');
        });
    });

    it('changes resource configuration and it applies', () => {
      const graphData: CreateGraphDto = {
        name: `Resource Config Test ${Date.now()}`,
        description:
          'Test runtime (resource) configuration change during live revision',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Test Agent',
                instructions: COMMAND_AGENT_INSTRUCTIONS,
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 10,
              },
            },
            {
              id: 'shell-1',
              template: 'shell-tool',
              config: {},
            },
            {
              id: 'runtime-1',
              template: 'docker-runtime',
              config: {
                runtimeType: 'Docker',
                image: 'python:3.11-slim',
                env: {
                  INITIAL_VAR: 'initial_value',
                },
              },
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'shell-1' },
            { from: 'shell-1', to: 'runtime-1' },
          ],
        },
      };

      let graphId: string;
      let currentVersion: string;
      let threadId: string;
      let internalThreadId: string;

      createGraph(graphData)
        .then((createResponse) => {
          expect(createResponse.status).to.equal(201);
          graphId = createResponse.body.id;
          currentVersion = createResponse.body.version;

          return runGraph(graphId);
        })
        .then((runResponse) => {
          expect(runResponse.status).to.equal(201);
          return waitForGraphToBeRunning(graphId);
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 5000)), {
            timeout: 7000,
          });
        })
        .then(() => {
          // Update runtime env vars (resource configuration)
          const updatedSchema = cloneSchema(graphData.schema);
          const runtimeNode = updatedSchema.nodes.find(
            (n) => n.id === 'runtime-1',
          );
          if (runtimeNode) {
            runtimeNode.config = {
              ...runtimeNode.config,
              env: {
                INITIAL_VAR: 'initial_value',
                UPDATED_VAR: 'updated_value', // Add new env var
              },
            };
          }

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
          const revision = revisionsResponse.body[0];
          expect(revision).to.exist;

          return waitForRevisionStatus(graphId, revision!.id, 'applied');
        })
        .then(() => {
          return cy.wrap(new Promise((resolve) => setTimeout(resolve, 3000)), {
            timeout: 5000,
          });
        })
        .then(() => {
          // Verify runtime still exists and is idle
          return getCompiledNodes(graphId);
        })
        .then((nodesResponse) => {
          expect(nodesResponse.status).to.equal(200);
          const runtimeNode = nodesResponse.body.find(
            (n: GraphNodeWithStatusDto) => n.id === 'runtime-1',
          );
          expect(runtimeNode).to.exist;
          expect(runtimeNode?.status).to.equal('idle');
        })
        .then(() =>
          // Give runtime extra time to settle before executing command
          cy.wrap(new Promise((resolve) => setTimeout(resolve, 5000)), {
            timeout: 7000,
          }),
        )
        .then(() =>
          executeTrigger(
            graphId,
            'trigger-1',
            {
              messages: ['Run this command: echo "test after resource change"'],
              async: true,
            },
            reqHeaders,
            60000,
          ),
        )
        .then((triggerResponse) => {
          expect(triggerResponse.status).to.equal(201);
          threadId = triggerResponse.body.threadId;

          // Wait for thread to complete (accepting any terminal status)
          return waitForThreadStatus(
            threadId,
            terminalThreadStatuses,
            45,
            2000,
          );
        })
        .then((threadResponse) => {
          internalThreadId = threadResponse.body.id;
          cy.task(
            'log',
            `[Resource Config Test] Thread status: ${JSON.stringify(threadResponse.body)}`,
          );
          return threadResponse;
        })
        .then(() => {
          // Verify everything still works by checking messages (use internal UUID, not externalThreadId)
          cy.task(
            'log',
            `[Resource Config Test] Getting messages for thread: ${internalThreadId}`,
          );
          return getThreadMessages(internalThreadId);
        });
    });
  });
});
