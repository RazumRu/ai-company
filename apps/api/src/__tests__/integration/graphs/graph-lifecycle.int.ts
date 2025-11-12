import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  GraphNodeSchemaType,
  GraphSchemaType,
} from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Graph Lifecycle Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
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

  describe('Full Graph Lifecycle', () => {
    it('should complete full graph lifecycle: create, update, run, destroy, delete', async () => {
      const graphData = createMockGraphData();

      // 1. Create
      const createResult = await graphsService.create(graphData);
      expect(createResult.status).toBe('created');

      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // 2. Update
      const updateData = {
        name: 'Updated Graph Name',
        description: 'Updated description',
        currentVersion: createResult.version,
      };
      const updateResult = await graphsService.update(graphId, updateData);
      expect(updateResult.name).toBe(updateData.name);
      expect(updateResult.description).toBe(updateData.description);

      // 3. Run
      const runResult = await graphsService.run(graphId);
      expect(runResult.status).toBe('running');

      // 4. Destroy
      const destroyResult = await graphsService.destroy(graphId);
      expect(destroyResult.status).toBe('stopped');

      // 5. Delete
      await graphsService.delete(graphId);

      // 6. Verify deletion
      await expect(graphsService.findById(graphId)).rejects.toThrow();
    });

    it('should stop and destroy running graph before deletion', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // Run the graph
      const runResult = await graphsService.run(graphId);
      expect(runResult.status).toBe('running');

      // Delete it directly (should automatically stop and destroy)
      await graphsService.delete(graphId);

      // Verify the graph is deleted
      await expect(graphsService.findById(graphId)).rejects.toThrow();
    });
  });

  describe('Version Management', () => {
    it('should increment version when updating schema on a stopped graph', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);
      const currentVersion = createResult.version;

      // Update schema
      const updatedSchema: GraphSchemaType = {
        ...createResult.schema,
        nodes: createResult.schema.nodes.map((node: GraphNodeSchemaType) =>
          node.id === 'agent-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  instructions: 'Updated instructions for integration test',
                },
              }
            : node,
        ),
      };

      const updateResult = await graphsService.update(graphId, {
        schema: updatedSchema,
        currentVersion,
      });

      expect(updateResult.version).not.toBe(currentVersion);

      // Verify the version was incremented
      const versionParts = currentVersion.split('.');
      const lastIndex = versionParts.length - 1;
      const expectedVersion = [...versionParts];
      expectedVersion[lastIndex] = String(
        parseInt(versionParts[lastIndex] || '0', 10) + 1,
      );

      expect(updateResult.version).toBe(expectedVersion.join('.'));
    });

    it('should return 400 when currentVersion does not match latest version', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);
      const originalVersion = createResult.version;

      // First update
      const updatedSchema: GraphSchemaType = {
        ...createResult.schema,
        nodes: createResult.schema.nodes.map((node: GraphNodeSchemaType) =>
          node.id === 'agent-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  instructions: 'First update',
                },
              }
            : node,
        ),
      };

      const firstUpdateResult = await graphsService.update(graphId, {
        schema: updatedSchema,
        currentVersion: originalVersion,
      });

      expect(firstUpdateResult).toBeDefined();

      // Second update with stale version - should fail
      const secondSchema: GraphSchemaType = {
        ...updatedSchema,
        nodes: updatedSchema.nodes.map((node: GraphNodeSchemaType) =>
          node.id === 'agent-1'
            ? {
                ...node,
                config: {
                  ...node.config,
                  instructions: 'Second update should fail',
                },
              }
            : node,
        ),
      };

      await expect(
        graphsService.update(graphId, {
          schema: secondSchema,
          currentVersion: originalVersion, // Using stale version
        }),
      ).rejects.toThrow('Graph version mismatch');
    });
  });

  describe('Graph Constraints', () => {
    it('should return 400 if graph is already running when trying to run again', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // First run
      const firstRunResult = await graphsService.run(graphId);
      expect(firstRunResult.status).toBe('running');

      // Second run should fail
      await expect(graphsService.run(graphId)).rejects.toThrow();
    });

    it('should allow graph to be destroyed even if no agent is executing', async () => {
      const graphData = createMockGraphData();

      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      // Run the graph
      const runResult = await graphsService.run(graphId);
      expect(runResult.status).toBe('running');

      // Destroy immediately without any active executions
      const destroyResult = await graphsService.destroy(graphId);
      expect(destroyResult.status).toBe('stopped');
    });
  });

  describe('Graph Creation', () => {
    it('should create a graph with minimal required fields', async () => {
      const minimalGraphData = {
        name: 'Minimal Test Graph',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Simple Agent',
                instructions: 'Test instructions',
                invokeModelName: 'gpt-5-mini',
              },
            },
          ],
          edges: [],
        },
      };

      const result = await graphsService.create(minimalGraphData);
      createdGraphIds.push(result.id);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(minimalGraphData.name);
      expect(result.status).toBe('created');
      expect(result.schema.nodes.length).toBe(1);
    });

    it('should get all graphs', async () => {
      // Create a few graphs
      const graph1 = await graphsService.create(createMockGraphData());
      const graph2 = await graphsService.create(createMockGraphData());
      createdGraphIds.push(graph1.id, graph2.id);

      const allGraphs = await graphsService.getAll();

      expect(allGraphs).toBeDefined();
      expect(Array.isArray(allGraphs)).toBe(true);
      expect(allGraphs.length).toBeGreaterThanOrEqual(2);

      const createdIds = allGraphs.map((g) => g.id);
      expect(createdIds).toContain(graph1.id);
      expect(createdIds).toContain(graph2.id);
    });
  });

  describe('Graph Updates', () => {
    it('should update only provided fields', async () => {
      const graphData = createMockGraphData();
      const createResult = await graphsService.create(graphData);
      const graphId = createResult.id;
      createdGraphIds.push(graphId);

      const originalName = createResult.name;

      // Update only description
      const updateResult = await graphsService.update(graphId, {
        description: 'Updated description only',
        currentVersion: createResult.version,
      });

      expect(updateResult.name).toBe(originalName); // Name should remain unchanged
      expect(updateResult.description).toBe('Updated description only');
      expect(updateResult.version).toBe(createResult.version); // Version unchanged for metadata-only update
    });
  });

  describe('Graph Stop with Active Agent Execution', () => {
    it(
      'should stop agent execution when graph is destroyed during execution',
      { timeout: 15000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Run the graph
        await graphsService.run(graphId);

        // Start an execution (this will be async)
        const execPromise = graphsService.executeTrigger(graphId, 'trigger-1', {
          messages: ['Long running task that should be interrupted'],
          async: true,
        });

        // Wait a bit to ensure execution has started
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Destroy the graph while execution is running
        const destroyResult = await graphsService.destroy(graphId);
        expect(destroyResult.status).toBe('stopped');

        // The execution should complete (likely with an interruption)
        const execResult = await execPromise;
        expect(execResult).toBeDefined();
      },
    );

    it(
      'should stop multiple concurrent agent executions when graph is destroyed',
      { timeout: 20000 },
      async () => {
        const graphData = createMockGraphData();
        const createResult = await graphsService.create(graphData);
        const graphId = createResult.id;
        createdGraphIds.push(graphId);

        // Run the graph
        await graphsService.run(graphId);

        // Start multiple concurrent executions
        const exec1Promise = graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['First concurrent task'],
            threadSubId: 'thread-1',
            async: true,
          },
        );

        const exec2Promise = graphsService.executeTrigger(
          graphId,
          'trigger-1',
          {
            messages: ['Second concurrent task'],
            threadSubId: 'thread-2',
            async: true,
          },
        );

        // Wait a bit to ensure executions have started
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Destroy the graph
        const destroyResult = await graphsService.destroy(graphId);
        expect(destroyResult.status).toBe('stopped');

        // Both executions should complete
        const [exec1Result, exec2Result] = await Promise.all([
          exec1Promise,
          exec2Promise,
        ]);
        expect(exec1Result).toBeDefined();
        expect(exec2Result).toBeDefined();
      },
    );
  });
});
