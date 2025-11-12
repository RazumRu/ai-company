import { INestApplication } from '@nestjs/common';
import { cloneDeep } from 'lodash';
import { compare } from 'semver';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  GraphNodeSchemaType,
  GraphRevisionStatus,
  GraphStatus,
} from '../../../v1/graphs/graphs.types';
import { GraphRevisionService } from '../../../v1/graphs/services/graph-revision.service';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { wait } from '../../test-utils';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Graph Revisions Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let revisionsService: GraphRevisionService;
  const createdGraphIds: string[] = [];

  const waitForGraphToBeRunning = async (id: string, timeoutMs = 60000) => {
    const startedAt = Date.now();

    while (true) {
      const graph = await graphsService.findById(id);

      if (graph.status === GraphStatus.Running) {
        return graph;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Graph ${id} did not reach running status within ${timeoutMs}ms (current status: ${graph.status})`,
        );
      }

      await wait(1000);
    }
  };

  const waitForRevisionStatus = async (
    graphId: string,
    revisionId: string,
    status: GraphRevisionStatus | GraphRevisionStatus[],
    timeoutMs = 60000,
  ) => {
    const startedAt = Date.now();
    const statuses = Array.isArray(status) ? status : [status];

    while (true) {
      const revision = await revisionsService.getRevisionById(
        graphId,
        revisionId,
      );

      if (revision && statuses.includes(revision.status)) {
        return revision;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Revision ${revisionId} did not reach status [${statuses.join(', ')}] within ${timeoutMs}ms`,
        );
      }

      await wait(1000);
    }
  };

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
    revisionsService = app.get<GraphRevisionService>(GraphRevisionService);
  });

  afterEach(async () => {
    // Cleanup all created graphs
    for (const graphId of createdGraphIds) {
      try {
        await graphsService.destroy(graphId);
      } catch {
        // Graph might not be running
      }
      try {
        await graphsService.delete(graphId);
      } catch {
        // Graph might already be deleted
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies a revision to a running graph', { timeout: 40000 }, async () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions for live revision';

    // Create graph
    const createResponse = await graphsService.create(graphData);
    expect(createResponse).toBeDefined();
    const graphId = createResponse.id;
    createdGraphIds.push(graphId);
    const currentVersion = createResponse.version;

    // Run graph
    await graphsService.run(graphId);
    await waitForGraphToBeRunning(graphId);

    // Update schema
    const updatedSchema = cloneDeep(createResponse.schema);
    updatedSchema.nodes = updatedSchema.nodes.map((node) =>
      node.id === 'agent-1'
        ? {
            ...node,
            config: {
              ...node.config,
              instructions: newInstructions,
            },
          }
        : node,
    );
    const updateResponse = await graphsService.update(graphId, {
      schema: updatedSchema,
      currentVersion,
    });

    expect(updateResponse).toBeDefined();
    expect(updateResponse.revision).toBeDefined();
    const revisionId = updateResponse.revision!.id;

    // Wait for the revision to be applied
    const revision = await waitForRevisionStatus(
      graphId,
      revisionId,
      GraphRevisionStatus.Applied,
    );

    expect(compare(currentVersion, revision.toVersion)).toBe(-1);
    expect(revision.error).toBeUndefined();

    // Verify graph version and schema
    const updatedGraph = await graphsService.findById(graphId);
    expect(updatedGraph.version).toBe(revision.toVersion);

    const agentNode = updatedGraph.schema.nodes.find(
      (node: GraphNodeSchemaType) => node.id === 'agent-1',
    );
    expect(agentNode?.config.instructions).toBe(newInstructions);
  });

  it(
    'processes queued revisions sequentially',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create graph
      const createResponse = await graphsService.create(graphData);
      expect(createResponse).toBeDefined();
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      const baseSchema = cloneDeep(createResponse.schema);
      let currentVersion = createResponse.version;

      // Run graph
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      // Queue first revision
      const firstSchema = cloneDeep(baseSchema);
      firstSchema.nodes = firstSchema.nodes.map((node) =>
        node.id === 'agent-1'
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: 'First revision instructions',
              },
            }
          : node,
      );

      const firstUpdateResponse = await graphsService.update(graphId, {
        schema: firstSchema,
        currentVersion,
      });

      // The revision should be returned immediately from the update call
      expect(firstUpdateResponse.revision).toBeDefined();
      const firstRevision = firstUpdateResponse.revision!;
      const firstRevisionId = firstRevision.id;
      expect(firstRevision.toVersion).toBeDefined();
      expect(firstRevision.toVersion).not.toBe(currentVersion);
      expect(compare(currentVersion, firstRevision.toVersion)).toBe(-1);

      // Fetch the graph's current version from DB (still unchanged, revision not applied yet)
      const graphAfterFirstUpdate = await graphsService.findById(graphId);
      currentVersion = graphAfterFirstUpdate.version;
      // Graph version should still be the same since revision hasn't been applied
      expect(currentVersion).toBe(createResponse.version);
      // But targetVersion should be updated to the first revision's toVersion
      expect(graphAfterFirstUpdate.targetVersion).toBe(firstRevision.toVersion);

      // Queue second revision immediately
      const secondSchema = cloneDeep(baseSchema);
      secondSchema.nodes = secondSchema.nodes.map((node) =>
        node.id === 'agent-1'
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: 'Second revision instructions',
              },
            }
          : node,
      );

      const secondUpdateResponse = await graphsService.update(graphId, {
        schema: secondSchema,
        currentVersion,
      });

      // The second revision should also be returned immediately
      expect(secondUpdateResponse.revision).toBeDefined();
      const secondRevision = secondUpdateResponse.revision!;
      const secondRevisionId = secondRevision.id;
      expect(secondRevision.toVersion).toBeDefined();
      // Second revision's toVersion should be greater than both the current graph version
      // and the first revision's toVersion (since they queue sequentially)
      expect(compare(currentVersion, secondRevision.toVersion)).toBe(-1);
      expect(compare(firstRevision.toVersion, secondRevision.toVersion)).toBe(-1);

      // Verify targetVersion is updated to second revision's toVersion
      const graphAfterSecondUpdate = await graphsService.findById(graphId);
      expect(graphAfterSecondUpdate.targetVersion).toBe(secondRevision.toVersion);
      // But actual version should still be unchanged (revisions not applied yet)
      expect(graphAfterSecondUpdate.version).toBe(createResponse.version);

      // Wait for both revisions to be applied sequentially
      // The revision queue should process them in order
      const firstApplied = await waitForRevisionStatus(
        graphId,
        firstRevisionId,
        GraphRevisionStatus.Applied,
        60000,
      );
      expect(firstApplied.status).toBe(GraphRevisionStatus.Applied);

      const secondApplied = await waitForRevisionStatus(
        graphId,
        secondRevisionId,
        GraphRevisionStatus.Applied,
        60000,
      );
      expect(secondApplied.status).toBe(GraphRevisionStatus.Applied);

      // Verify the final graph has the second update
      const updatedGraph = await graphsService.findById(graphId);
      expect(updatedGraph.version).toBe(secondRevision.toVersion);

      const agentNode = updatedGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === 'agent-1',
      );
      expect(agentNode?.config.instructions).toBe(
        'Second revision instructions',
      );
    },
  );
});
