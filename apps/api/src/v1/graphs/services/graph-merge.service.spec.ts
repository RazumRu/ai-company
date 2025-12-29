import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GraphSchemaType } from '../graphs.types';
import { GraphMergeService } from './graph-merge.service';

describe('GraphMergeService', () => {
  let service: GraphMergeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GraphMergeService],
    }).compile();

    service = module.get<GraphMergeService>(GraphMergeService);
  });

  describe('mergeSchemas', () => {
    it('should merge non-conflicting changes successfully', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'head-changed' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
          { id: 'node-2', template: 'test', config: { value: 'client-new' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toBeDefined();
      expect(result.mergedSchema!.nodes).toHaveLength(2);
      expect(result.mergedSchema?.nodes[0]?.config).toEqual({
        value: 'head-changed',
      });
      expect(result.mergedSchema!.nodes[1]).toEqual({
        id: 'node-2',
        template: 'test',
        config: { value: 'client-new' },
      });
      expect(result.conflicts).toHaveLength(0);
    });

    it('should return success when client and head have same changes', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'changed' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'changed' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toEqual(headSchema);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect content conflict when both modify same field differently', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { image: 'python:3.11' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { image: 'python:3.12' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { image: 'python:3.13' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0]).toMatchObject({
        path: '/nodes/0/config/image',
        type: 'concurrent_modification',
        baseValue: 'python:3.11',
        headValue: 'python:3.12',
        clientValue: 'python:3.13',
      });
    });

    it('should detect structural conflict when head deletes and client modifies', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'modified' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0]?.type).toBe('deletion_conflict');
    });

    it('should handle no changes from client (client === base)', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'head-changed' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toEqual(headSchema);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle no changes from head (head === base)', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: { value: 'client-changed' },
          },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toEqual(clientSchema);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle saving with no changes when all schemas are identical', () => {
      const schema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const result = service.mergeSchemas(schema, schema, schema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toEqual(schema);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should handle saving with no changes when edges is undefined vs empty array', () => {
      const baseSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
      };

      const headSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
        edges: [],
      };

      const clientSchema: GraphSchemaType = {
        nodes: [
          { id: 'node-1', template: 'test', config: { value: 'original' } },
        ],
      };

      const result = service.mergeSchemas(baseSchema, headSchema, clientSchema);

      expect(result.success).toBe(true);
      expect(result.mergedSchema).toBeDefined();
      expect(result.conflicts).toHaveLength(0);
    });
  });
});
