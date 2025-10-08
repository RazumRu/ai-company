import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';

import { CompiledGraph, CompiledGraphNode } from '../graphs.types';

/**
 * GraphRegistry maintains a registry of all compiled and running graphs.
 * This allows us to:
 * - Track active graphs
 * - Access compiled graphs for management operations
 * - Stop specific nodes within a graph
 * - Destroy graphs and their resources
 */
@Injectable()
export class GraphRegistry {
  private readonly graphs = new Map<string, CompiledGraph>();

  /**
   * Registers a compiled graph in the registry
   */
  register(graphId: string, compiledGraph: CompiledGraph): void {
    if (this.graphs.has(graphId)) {
      throw new BadRequestException('GRAPH_ALREADY_REGISTERED');
    }

    this.graphs.set(graphId, compiledGraph);
  }

  /**
   * Unregisters a graph from the registry without destroying it
   */
  unregister(graphId: string): void {
    this.graphs.delete(graphId);
  }

  /**
   * Retrieves a compiled graph by ID
   */
  get(graphId: string): CompiledGraph | undefined {
    return this.graphs.get(graphId);
  }

  /**
   * Gets a specific node from a graph
   */
  getNode(graphId: string, nodeId: string): CompiledGraphNode | undefined {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      return undefined;
    }

    return graph.nodes.get(nodeId);
  }

  /**
   * Destroys a graph and removes it from the registry
   */
  async destroy(graphId: string): Promise<void> {
    const graph = this.graphs.get(graphId);
    if (!graph) {
      return;
    }

    try {
      await graph.destroy();
    } finally {
      // Always remove from registry even if destroy fails
      this.graphs.delete(graphId);
    }
  }
}
