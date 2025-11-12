import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { createMockGraphData } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

describe('Graph Validation Integration Tests', () => {
  let app: INestApplication;
  let graphsService: GraphsService;

  beforeAll(async () => {
    app = await createTestModule();

    graphsService = app.get<GraphsService>(GraphsService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Schema Validation', () => {
    it('should return 400 for duplicate node IDs', async () => {
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

      await expect(graphsService.create(invalidGraphData)).rejects.toThrow(
        'Duplicate node IDs found in graph schema',
      );
    });

    it('should return 400 for invalid template', async () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'invalid-template-that-does-not-exist',
              config: {},
            },
          ],
          edges: [],
        },
      });

      await expect(graphsService.create(invalidGraphData)).rejects.toThrow(
        "Template 'invalid-template-that-does-not-exist' is not registered",
      );
    });

    it('should return 400 for edge referencing non-existent target node', async () => {
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

      await expect(graphsService.create(invalidGraphData)).rejects.toThrow(
        'Edge references non-existent target node: non-existent-node',
      );
    });

    it('should return 400 for edge referencing non-existent source node', async () => {
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

      await expect(graphsService.create(invalidGraphData)).rejects.toThrow(
        'Edge references non-existent source node: non-existent-node',
      );
    });

    it('should return 400 for invalid template configuration', async () => {
      const invalidGraphData = createMockGraphData({
        schema: {
          nodes: [
            {
              id: 'node-1',
              template: 'docker-runtime',
              config: { invalidConfig: 'this-should-fail' },
            },
          ],
          edges: [],
        },
      });

      await expect(graphsService.create(invalidGraphData)).rejects.toThrow(
        'Invalid configuration for template',
      );
    });
  });

  describe('404 Error Tests', () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    it('should return 404 for non-existent graph on update', async () => {
      await expect(
        graphsService.update(nonExistentId, {
          name: 'Updated name',
          currentVersion: '1.0.0',
        }),
      ).rejects.toThrow();
    });

    it('should return 404 for non-existent graph on run', async () => {
      await expect(graphsService.run(nonExistentId)).rejects.toThrow();
    });

    it('should return 404 for non-existent graph on destroy', async () => {
      await expect(graphsService.destroy(nonExistentId)).rejects.toThrow();
    });

    it('should return 404 for non-existent graph on delete', async () => {
      await expect(graphsService.delete(nonExistentId)).rejects.toThrow();
    });

    it('should return 404 for non-existent graph on findById', async () => {
      await expect(graphsService.findById(nonExistentId)).rejects.toThrow();
    });
  });
});
