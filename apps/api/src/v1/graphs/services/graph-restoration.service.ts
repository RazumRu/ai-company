import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';

/**
 * GraphRestorationService handles restoring graphs with their agent states
 * after server restart. It queries the database for graphs with 'running' status
 * and recompiles them into the GraphRegistry.
 */
@Injectable()
export class GraphRestorationService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphRegistry: GraphRegistry,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Restores all graphs that were running before server restart
   */
  async restoreRunningGraphs(): Promise<void> {
    this.logger.log('Starting graph restoration process...');

    try {
      const runningGraphs = await this.graphDao.getRunningGraphs();

      if (runningGraphs.length === 0) {
        this.logger.log('No running graphs to restore');
        return;
      }

      this.logger.log('Graphs to restore', {
        count: runningGraphs.length,
        graphIds: runningGraphs.map((g) => g.id),
      });

      const restorationPromises = runningGraphs.map((graph) =>
        this.restoreGraph(graph).catch((error) => {
          this.logger.error(
            error instanceof Error ? error : new Error(String(error)),
            `Failed to restore graph ${graph.id}`,
            {
              graphId: graph.id,
              graphName: graph.name,
            },
          );
          return { graphId: graph.id, error };
        }),
      );

      const results = await Promise.allSettled(restorationPromises);

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      this.logger.log('Restoration complete', {
        total: runningGraphs.length,
        successful,
        failed,
      });
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to restore running graphs',
      );
    }
  }

  /**
   * Restores a single graph by recompiling it and registering it in the registry
   */
  private async restoreGraph(graph: GraphEntity): Promise<void> {
    const { id, name, schema } = graph;

    try {
      // Check if graph is already registered (shouldn't happen, but safety check)
      if (this.graphRegistry.get(id)) {
        return;
      }

      // Compile the graph
      const compiledGraph = await this.graphCompiler.compile(schema, {
        graphId: graph.id,
        name: graph.name,
        version: graph.version,
      });

      // Register the compiled graph in the registry
      this.graphRegistry.register(id, compiledGraph);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to restore graph ${id}`,
        {
          graphId: id,
          graphName: name,
        },
      );

      // Update graph status to error in database
      await this.graphDao.updateById(id, {
        status: GraphStatus.Error,
        error: `Restoration failed: ${(error as Error).message}`,
      });

      throw error;
    }
  }
}
