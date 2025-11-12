import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { cloneDeep } from 'lodash';
import { compare } from 'semver';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SimpleAgentSchemaType } from '../../../v1/agents/services/agents/simple-agent';
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

// Test constants to reduce brittleness
const TEST_AGENT_NODE_ID = 'agent-1';

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
          `Revision ${revisionId} did not reach status [${statuses.join(', ')}] within ${timeoutMs}ms (current: ${revision?.status || 'not found'})`,
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
      } catch (error: unknown) {
        // Only ignore expected "not running" errors - re-throw others
        if (
          error instanceof BaseException &&
          error.errorCode !== 'GRAPH_NOT_RUNNING' &&
          error.errorCode !== 'GRAPH_NOT_FOUND'
        ) {
          console.error(`Unexpected error destroying graph ${graphId}:`, error);
          throw error;
        }
      }
      try {
        await graphsService.delete(graphId);
      } catch (error: unknown) {
        // Only ignore expected "not found" errors - re-throw others
        if (
          error instanceof BaseException &&
          error.errorCode !== 'GRAPH_NOT_FOUND'
        ) {
          console.error(`Unexpected error deleting graph ${graphId}:`, error);
          throw error;
        }
      }
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies a revision to a running graph', { timeout: 60000 }, async () => {
    const graphData = createMockGraphData();
    const newInstructions = 'Updated instructions for live revision';

    // Create graph
    const createResponse = await graphsService.create(graphData);
    expect(createResponse.id).toMatch(/^[0-9a-f-]{36}$/); // Valid UUID
    expect(createResponse.version).toBe('1.0.0');
    expect(createResponse.targetVersion).toBe('1.0.0');
    expect(createResponse.status).toBe(GraphStatus.Created);
    const graphId = createResponse.id;
    createdGraphIds.push(graphId);
    const currentVersion = createResponse.version;

    // Run graph
    await graphsService.run(graphId);
    await waitForGraphToBeRunning(graphId);

    // Update schema
    const updatedSchema = cloneDeep(createResponse.schema);
    updatedSchema.nodes = updatedSchema.nodes.map((node) =>
      node.id === TEST_AGENT_NODE_ID
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

    // Verify update response and revision
    expect(updateResponse.graph.id).toBe(graphId);
    expect(updateResponse.revision).toBeDefined();
    expect(updateResponse.revision!.status).toBe(GraphRevisionStatus.Pending);
    expect(updateResponse.revision!.toVersion).toBe('1.0.1');
    expect(updateResponse.revision!.graphId).toBe(graphId);
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
      (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
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
      expect(createResponse.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(createResponse.version).toBe('1.0.0');
      expect(createResponse.status).toBe(GraphStatus.Created);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);

      const baseSchema = cloneDeep(createResponse.schema);
      const initialVersion = createResponse.version;

      // Run graph
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      // Queue first revision - modify instructions
      const firstSchema = cloneDeep(baseSchema);
      firstSchema.nodes = firstSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'First revision instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const firstUpdateResponse = await graphsService.update(graphId, {
        schema: firstSchema,
        currentVersion: initialVersion,
      });

      // Verify first revision was created correctly
      expect(firstUpdateResponse.revision).toBeDefined();
      const firstRevision = firstUpdateResponse.revision!;
      expect(firstRevision.status).toBe(GraphRevisionStatus.Pending);
      expect(firstRevision.graphId).toBe(graphId);
      expect(firstRevision.toVersion).toBe('1.0.1');
      expect(compare(initialVersion, firstRevision.toVersion)).toBe(-1);

      // Wait for first revision to be applied (true sequential processing)
      await waitForRevisionStatus(
        graphId,
        firstRevision.id,
        GraphRevisionStatus.Applied,
        60000,
      );

      // Fetch updated graph state after first revision
      const graphAfterFirst = await graphsService.findById(graphId);
      expect(graphAfterFirst.version).toBe(firstRevision.toVersion);
      expect(graphAfterFirst.targetVersion).toBe(firstRevision.toVersion);

      // Queue second revision based on updated state - overwrites first instruction
      const secondSchema = cloneDeep(graphAfterFirst.schema);
      secondSchema.nodes = secondSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Second revision overwrites first',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const secondUpdateResponse = await graphsService.update(graphId, {
        schema: secondSchema,
        currentVersion: graphAfterFirst.version,
      });

      // Verify second revision was created correctly
      expect(secondUpdateResponse.revision).toBeDefined();
      const secondRevision = secondUpdateResponse.revision!;
      expect(secondRevision.status).toBe(GraphRevisionStatus.Pending);
      expect(secondRevision.graphId).toBe(graphId);
      expect(secondRevision.toVersion).toBe('1.0.2');
      expect(compare(firstRevision.toVersion, secondRevision.toVersion)).toBe(
        -1,
      );

      // Wait for second revision to be applied
      await waitForRevisionStatus(
        graphId,
        secondRevision.id,
        GraphRevisionStatus.Applied,
        60000,
      );

      // Verify final state: second revision overwrote first (true sequential behavior)
      const finalGraph = await graphsService.findById(graphId);
      expect(finalGraph.version).toBe(secondRevision.toVersion);
      expect(finalGraph.targetVersion).toBe(secondRevision.toVersion);

      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(
        'Second revision overwrites first',
      );
    },
  );

  it(
    'merges non-conflicting concurrent edits from multiple users',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      // Run graph
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      // User A modifies instructions (non-conflicting with User B)
      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User A instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      expect(userAUpdate.revision).toBeDefined();
      const userARevisionId = userAUpdate.revision!.id;

      // User B modifies model (non-conflicting with User A)
      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                invokeModelName: 'gpt-4-turbo',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      // User B submits based on same currentVersion (concurrent edit)
      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      expect(userBUpdate.revision).toBeDefined();
      const userBRevisionId = userBUpdate.revision!.id;

      // Both revisions should be accepted (non-conflicting)
      await waitForRevisionStatus(
        graphId,
        userARevisionId,
        GraphRevisionStatus.Applied,
      );
      await waitForRevisionStatus(
        graphId,
        userBRevisionId,
        GraphRevisionStatus.Applied,
      );

      // Final graph should have both changes merged
      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('User A instructions');
      expect((agentNode?.config as SimpleAgentSchemaType).invokeModelName).toBe(
        'gpt-4-turbo',
      );
    },
  );

  it(
    'rejects stale edits and allows refresh-retry flow',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      // Run graph
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      // User A modifies instructions
      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User A instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      // Wait for User A's revision to apply
      await waitForRevisionStatus(
        graphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Get current state after User A's changes
      const graphAfterUserA = await graphsService.findById(graphId);
      const currentVersion = graphAfterUserA.version;

      // User B tries to modify instructions based on OLD version (should fail)
      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'User B conflicting instructions',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      // User B submits based on OLD version (should get VERSION_CONFLICT)
      await expect(
        graphsService.update(graphId, {
          schema: userBSchema,
          currentVersion: baseVersion, // Using old version
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/version/i),
      });

      // User B refreshes and submits with correct version (should succeed)
      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: currentVersion, // Current version
      });

      expect(userBUpdate.revision).toBeDefined();

      // Wait for User B's revision to apply
      await waitForRevisionStatus(
        graphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Verify User B's changes applied after refresh
      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe(
        'User B conflicting instructions',
      );
    },
  );

  it(
    'handles three users with cascading changes',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create and run graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      let currentVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      // User 1: Add temperature config
      const user1Schema = cloneDeep(baseSchema);
      user1Schema.nodes = user1Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                temperature: 0.7,
              },
            }
          : node,
      );

      const user1Update = await graphsService.update(graphId, {
        schema: user1Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user1Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Fetch updated graph for User 2
      const graphAfterUser1 = await graphsService.findById(graphId);
      currentVersion = graphAfterUser1.version;

      // User 2: Add max_tokens (non-conflicting with User 1)
      const user2Schema = cloneDeep(graphAfterUser1.schema);
      user2Schema.nodes = user2Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                max_tokens: 2000,
              },
            }
          : node,
      );

      const user2Update = await graphsService.update(graphId, {
        schema: user2Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user2Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Fetch updated graph for User 3
      const graphAfterUser2 = await graphsService.findById(graphId);
      currentVersion = graphAfterUser2.version;

      // User 3: Modify instructions (non-conflicting with Users 1 & 2)
      const user3Schema = cloneDeep(graphAfterUser2.schema);
      user3Schema.nodes = user3Schema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                instructions: 'Cascaded instructions from User 3',
              },
            }
          : node,
      );

      const user3Update = await graphsService.update(graphId, {
        schema: user3Schema,
        currentVersion,
      });

      await waitForRevisionStatus(
        graphId,
        user3Update.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Verify all three changes are present
      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.temperature).toBe(0.7);
      expect(agentNode?.config.max_tokens).toBe(2000);
      expect(agentNode?.config.instructions).toBe(
        'Cascaded instructions from User 3',
      );
    },
  );

  it(
    'rejects concurrent conflicting edits to same field',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create and run graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      // Submit first edit - should succeed
      const schema1 = cloneDeep(baseSchema);
      schema1.nodes = schema1.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'First edit',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      const firstResponse = await graphsService.update(graphId, {
        schema: schema1,
        currentVersion: baseVersion,
      });
      expect(firstResponse.revision).toBeDefined();

      // Immediately submit second edit to same field from same base - should get MERGE_CONFLICT
      // because targetVersion has moved to 1.0.1 with first edit's schema
      const schema2 = cloneDeep(baseSchema);
      schema2.nodes = schema2.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...(node.config as SimpleAgentSchemaType),
                instructions: 'Second conflicting edit',
              } satisfies SimpleAgentSchemaType,
            }
          : node,
      );

      await expect(
        graphsService.update(graphId, {
          schema: schema2,
          currentVersion: baseVersion,
        }),
      ).rejects.toMatchObject({
        errorCode: 'MERGE_CONFLICT',
        statusCode: 400,
      });

      // Verify only the first revision was created and applied
      await waitForRevisionStatus(
        graphId,
        firstResponse.revision!.id,
        GraphRevisionStatus.Applied,
      );

      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('First edit');
    },
  );

  it(
    'handles truly sequential edits when waiting between submissions',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create and run graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const revisionIds: string[] = [];

      // Submit 3 sequential edits, waiting for each to apply before the next
      for (let i = 1; i <= 3; i++) {
        // Fetch current graph state
        const graph = await graphsService.findById(graphId);

        // Build schema from current state
        const schema = cloneDeep(graph.schema);
        schema.nodes = schema.nodes.map((node) =>
          node.id === TEST_AGENT_NODE_ID
            ? {
                ...node,
                config: {
                  ...(node.config as SimpleAgentSchemaType),
                  instructions: `Sequential edit ${i}`,
                } satisfies SimpleAgentSchemaType,
              }
            : node,
        );

        const updateResponse = await graphsService.update(graphId, {
          schema,
          currentVersion: graph.version,
        });

        expect(updateResponse.revision).toBeDefined();
        revisionIds.push(updateResponse.revision!.id);

        // Wait for this revision to apply before submitting next
        await waitForRevisionStatus(
          graphId,
          updateResponse.revision!.id,
          GraphRevisionStatus.Applied,
        );
      }

      // Verify all 3 revisions succeeded and were applied
      expect(revisionIds.length).toBe(3);
      const allRevisions = await revisionsService.getRevisions(graphId, {});
      expect(allRevisions.length).toBe(3);
      expect(
        allRevisions.every((r) => r.status === GraphRevisionStatus.Applied),
      ).toBe(true);

      // Verify final state has the last edit
      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.instructions).toBe('Sequential edit 3');
      expect(finalGraph.targetVersion).toBe(finalGraph.version);
    },
  );

  it(
    'handles non-conflicting structural changes',
    { timeout: 60000 },
    async () => {
      const graphData = createMockGraphData();

      // Create and run graph
      const createResponse = await graphsService.create(graphData);
      const graphId = createResponse.id;
      createdGraphIds.push(graphId);
      await graphsService.run(graphId);
      await waitForGraphToBeRunning(graphId);

      const baseVersion = createResponse.version;
      const baseSchema = createResponse.schema;

      // User A adds temperature to agent-1 (non-conflicting with User B)
      const userASchema = cloneDeep(baseSchema);
      userASchema.nodes = userASchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                temperature: 0.8,
              },
            }
          : node,
      );

      const userAUpdate = await graphsService.update(graphId, {
        schema: userASchema,
        currentVersion: baseVersion,
      });

      expect(userAUpdate.revision).toBeDefined();

      // User B adds max_tokens to agent-1 (non-conflicting with User A)
      const userBSchema = cloneDeep(baseSchema);
      userBSchema.nodes = userBSchema.nodes.map((node) =>
        node.id === TEST_AGENT_NODE_ID
          ? {
              ...node,
              config: {
                ...node.config,
                max_tokens: 1500,
              },
            }
          : node,
      );

      const userBUpdate = await graphsService.update(graphId, {
        schema: userBSchema,
        currentVersion: baseVersion,
      });

      expect(userBUpdate.revision).toBeDefined();

      // Wait for both to apply
      await waitForRevisionStatus(
        graphId,
        userAUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );
      await waitForRevisionStatus(
        graphId,
        userBUpdate.revision!.id,
        GraphRevisionStatus.Applied,
      );

      // Verify both changes are present (merged)
      const finalGraph = await graphsService.findById(graphId);
      const agentNode = finalGraph.schema.nodes.find(
        (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
      );
      expect(agentNode?.config.temperature).toBe(0.8);
      expect(agentNode?.config.max_tokens).toBe(1500);
    },
  );

  it('applies revision immediately for non-running graph', async () => {
    const graphData = createMockGraphData();

    // Create graph (don't run it)
    const createResponse = await graphsService.create(graphData);
    const graphId = createResponse.id;
    createdGraphIds.push(graphId);

    expect(createResponse.status).toBe(GraphStatus.Created);
    const currentVersion = createResponse.version;

    // Update schema on non-running graph
    const updatedSchema = cloneDeep(createResponse.schema);
    updatedSchema.nodes = updatedSchema.nodes.map((node) =>
      node.id === TEST_AGENT_NODE_ID
        ? {
            ...node,
            config: {
              ...node.config,
              instructions: 'Non-running graph instructions',
            },
          }
        : node,
    );

    const updateResponse = await graphsService.update(graphId, {
      schema: updatedSchema,
      currentVersion,
    });

    // For non-running graphs, no revision should be created
    // Changes are applied immediately
    expect(updateResponse.revision).toBeUndefined();

    // Verify changes applied immediately
    const updatedGraph = await graphsService.findById(graphId);
    expect(updatedGraph.version).not.toBe(currentVersion); // Version incremented
    expect(updatedGraph.version).toBe(updatedGraph.targetVersion); // No pending revisions

    const agentNode = updatedGraph.schema.nodes.find(
      (node: GraphNodeSchemaType) => node.id === TEST_AGENT_NODE_ID,
    );
    expect(agentNode?.config.instructions).toBe(
      'Non-running graph instructions',
    );
  });
});
