import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CompiledGraph,
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../graphs.types';
import { GraphRegistry } from './graph-registry';

describe('GraphRegistry', () => {
  let registry: GraphRegistry;

  const createMockCompiledGraph = (nodeCount = 2): CompiledGraph => {
    const nodes = new Map<string, CompiledGraphNode>();

    for (let i = 1; i <= nodeCount; i++) {
      nodes.set(`node-${i}`, {
        id: `node-${i}`,
        type: i % 2 === 0 ? NodeKind.Runtime : NodeKind.Tool,
        template: i % 2 === 0 ? 'docker-runtime' : 'web-search-tool',
        config: {},
        instance: { mockInstance: `instance-${i}` },
      });
    }

    const state = {
      getSnapshots: vi.fn().mockImplementation(() =>
        Array.from(nodes.values()).map((node) => ({
          id: node.id,
          name: node.id,
          template: node.template,
          type: node.type,
          status: GraphNodeStatus.Idle,
          config: node.config,
          error: null,
        })),
      ),
      handleGraphDestroyed: vi.fn(),
    } as unknown as CompiledGraph['state'];

    return {
      nodes,
      edges: [{ from: 'node-1', to: 'node-2' }],
      state,
      destroy: vi.fn().mockResolvedValue(undefined),
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GraphRegistry],
    }).compile();

    registry = module.get<GraphRegistry>(GraphRegistry);
  });

  describe('register', () => {
    it('should register a new graph successfully', () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();

      expect(() => registry.register(graphId, compiledGraph)).not.toThrow();
    });

    it('should throw error when registering duplicate graph ID', () => {
      const graphId = 'test-graph-1';
      const compiledGraph1 = createMockCompiledGraph();
      const compiledGraph2 = createMockCompiledGraph();

      registry.register(graphId, compiledGraph1);

      expect(() => registry.register(graphId, compiledGraph2)).toThrow(
        BadRequestException,
      );
    });

    it('should allow registering different graphs with different IDs', () => {
      const graphId1 = 'test-graph-1';
      const graphId2 = 'test-graph-2';
      const compiledGraph1 = createMockCompiledGraph();
      const compiledGraph2 = createMockCompiledGraph();

      expect(() => {
        registry.register(graphId1, compiledGraph1);
        registry.register(graphId2, compiledGraph2);
      }).not.toThrow();
    });
  });

  describe('unregister', () => {
    it('should unregister an existing graph', () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();

      registry.register(graphId, compiledGraph);
      expect(registry.get(graphId)).toBeDefined();

      registry.unregister(graphId);
      expect(registry.get(graphId)).toBeUndefined();
    });

    it('should handle unregistering non-existent graph gracefully', () => {
      const graphId = 'non-existent-graph';

      expect(() => registry.unregister(graphId)).not.toThrow();
    });
  });

  describe('get', () => {
    it('should return registered graph', () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();

      registry.register(graphId, compiledGraph);

      const result = registry.get(graphId);
      expect(result).toBe(compiledGraph);
    });

    it('should return undefined for non-existent graph', () => {
      const graphId = 'non-existent-graph';

      const result = registry.get(graphId);
      expect(result).toBeUndefined();
    });
  });

  describe('getNode', () => {
    it('should return specific node from registered graph', () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph(3);

      registry.register(graphId, compiledGraph);

      const result = registry.getNode(graphId, 'node-2');
      expect(result).toEqual({
        id: 'node-2',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: { mockInstance: 'instance-2' },
      });
    });

    it('should return undefined for non-existent graph', () => {
      const graphId = 'non-existent-graph';

      const result = registry.getNode(graphId, 'node-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent node in existing graph', () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph(2);

      registry.register(graphId, compiledGraph);

      const result = registry.getNode(graphId, 'non-existent-node');
      expect(result).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should destroy registered graph and remove from registry', async () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();
      const destroySpy = vi.spyOn(compiledGraph, 'destroy');

      registry.register(graphId, compiledGraph);

      await registry.destroy(graphId);

      expect(destroySpy).toHaveBeenCalledOnce();
      expect(registry.get(graphId)).toBeUndefined();
    });

    it('should handle destroying non-existent graph gracefully', async () => {
      const graphId = 'non-existent-graph';

      await expect(registry.destroy(graphId)).resolves.not.toThrow();
    });

    it('should remove graph from registry even if destroy fails', async () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();
      const _destroySpy = vi
        .spyOn(compiledGraph, 'destroy')
        .mockRejectedValue(new Error('Destroy failed'));

      registry.register(graphId, compiledGraph);

      await expect(registry.destroy(graphId)).rejects.toThrow('Destroy failed');
      expect(registry.get(graphId)).toBeUndefined();
    });

    it('should handle multiple destroy calls on same graph', async () => {
      const graphId = 'test-graph-1';
      const compiledGraph = createMockCompiledGraph();
      const destroySpy = vi.spyOn(compiledGraph, 'destroy');

      registry.register(graphId, compiledGraph);

      await registry.destroy(graphId);
      await registry.destroy(graphId); // Second call should be no-op

      expect(destroySpy).toHaveBeenCalledOnce();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty registry', () => {
      expect(registry.get('any-id')).toBeUndefined();
      expect(registry.getNode('any-id', 'any-node')).toBeUndefined();
    });

    it('should handle graph with no nodes', () => {
      const graphId = 'empty-graph';
      const emptyGraph: CompiledGraph = {
        nodes: new Map(),
        edges: [],
        state: {
          getSnapshots: vi.fn().mockReturnValue([]),
          handleGraphDestroyed: vi.fn(),
        } as unknown as CompiledGraph['state'],
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      registry.register(graphId, emptyGraph);

      expect(registry.getNode(graphId, 'any-node')).toBeUndefined();
    });

    it('should handle graph with single node', () => {
      const graphId = 'single-node-graph';
      const singleNodeGraph: CompiledGraph = {
        nodes: new Map([
          [
            'only-node',
            {
              id: 'only-node',
              type: NodeKind.SimpleAgent,
              template: 'simple-agent',
              config: {},
              instance: { agent: 'test-agent' },
            },
          ],
        ]),
        edges: [],
        state: {
          getSnapshots: vi.fn().mockReturnValue([]),
          handleGraphDestroyed: vi.fn(),
        } as unknown as CompiledGraph['state'],
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      registry.register(graphId, singleNodeGraph);

      const result = registry.getNode(graphId, 'only-node');
      expect(result).toEqual({
        id: 'only-node',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: { agent: 'test-agent' },
      });
    });

    it('should handle concurrent operations', async () => {
      const graphId = 'concurrent-graph';
      const compiledGraph = createMockCompiledGraph();

      registry.register(graphId, compiledGraph);

      const operations = [
        registry.get(graphId),
        registry.getNode(graphId, 'node-1'),
        registry.getNode(graphId, 'node-2'),
      ];

      const results = await Promise.all(operations);

      expect(results[0]).toBe(compiledGraph);
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete graph lifecycle', async () => {
      const graphId = 'lifecycle-graph';
      const compiledGraph = createMockCompiledGraph(3);
      const destroySpy = vi.spyOn(compiledGraph, 'destroy');

      registry.register(graphId, compiledGraph);
      expect(registry.get(graphId)).toBe(compiledGraph);

      // Access nodes
      const node1 = registry.getNode(graphId, 'node-1');
      const node2 = registry.getNode(graphId, 'node-2');
      const node3 = registry.getNode(graphId, 'node-3');

      expect(node1).toBeDefined();
      expect(node2).toBeDefined();
      expect(node3).toBeDefined();

      // Destroy
      await registry.destroy(graphId);
      expect(destroySpy).toHaveBeenCalledOnce();
      expect(registry.get(graphId)).toBeUndefined();
    });

    it('should handle multiple graphs independently', async () => {
      const graphId1 = 'graph-1';
      const graphId2 = 'graph-2';
      const compiledGraph1 = createMockCompiledGraph(2);
      const compiledGraph2 = createMockCompiledGraph(3);

      registry.register(graphId1, compiledGraph1);
      registry.register(graphId2, compiledGraph2);

      // Verify both exist
      expect(registry.get(graphId1)).toBe(compiledGraph1);
      expect(registry.get(graphId2)).toBe(compiledGraph2);

      // Destroy one
      await registry.destroy(graphId1);

      // Verify one is gone, other remains
      expect(registry.get(graphId1)).toBeUndefined();
      expect(registry.get(graphId2)).toBe(compiledGraph2);

      // Destroy the other
      await registry.destroy(graphId2);
      expect(registry.get(graphId2)).toBeUndefined();
    });

    it('should handle rapid register/unregister cycles', () => {
      const graphId = 'rapid-cycle-graph';
      const compiledGraph = createMockCompiledGraph();

      // Rapid cycles
      for (let i = 0; i < 10; i++) {
        registry.register(graphId, compiledGraph);
        expect(registry.get(graphId)).toBe(compiledGraph);
        registry.unregister(graphId);
        expect(registry.get(graphId)).toBeUndefined();
      }
    });
  });

  describe('type safety and node types', () => {
    it('should handle different node types correctly', () => {
      const graphId = 'mixed-types-graph';
      const mixedGraph: CompiledGraph = {
        nodes: new Map([
          [
            'runtime-node',
            {
              id: 'runtime-node',
              type: NodeKind.Runtime,
              template: 'docker-runtime',
              config: {},
              instance: { container: 'docker-container' },
            },
          ],
          [
            'tool-node',
            {
              id: 'tool-node',
              type: NodeKind.Tool,
              template: 'shell-tool',
              config: {},
              instance: { toolName: 'shell-tool' },
            },
          ],
          [
            'agent-node',
            {
              id: 'agent-node',
              type: NodeKind.SimpleAgent,
              template: 'simple-agent',
              config: {},
              instance: { agentName: 'test-agent' },
            },
          ],
          [
            'trigger-node',
            {
              id: 'trigger-node',
              type: NodeKind.Trigger,
              template: 'manual-trigger',
              config: {},
              instance: { triggerType: 'manual' },
            },
          ],
        ]),
        edges: [],
        state: {
          getSnapshots: vi.fn().mockReturnValue([]),
          handleGraphDestroyed: vi.fn(),
        } as unknown as CompiledGraph['state'],
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      registry.register(graphId, mixedGraph);

      // Verify each node type is accessible
      expect(registry.getNode(graphId, 'runtime-node')?.type).toBe(
        NodeKind.Runtime,
      );
      expect(registry.getNode(graphId, 'tool-node')?.type).toBe(NodeKind.Tool);
      expect(registry.getNode(graphId, 'agent-node')?.type).toBe(
        NodeKind.SimpleAgent,
      );
      expect(registry.getNode(graphId, 'trigger-node')?.type).toBe(
        NodeKind.Trigger,
      );
    });
  });
});
