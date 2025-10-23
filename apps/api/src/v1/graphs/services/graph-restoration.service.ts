import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { DockerRuntime } from '../../runtime/services/docker-runtime';

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
   * Process order:
   * 1. First: Clean up all temporary runtime containers
   * 2. Then: Destroy temporary graphs (run destroy pipeline)
   * 3. Finally: Restore permanent graphs
   */
  async restoreRunningGraphs(): Promise<void> {
    this.logger.log('Starting graph restoration process...');

    // STEP 1: Clean up all temporary runtime containers
    await this.cleanupTemporaryRuntimes();

    // STEP 2: Destroy temporary graphs first (run destroy pipeline)
    const temporaryGraphs = await this.graphDao.getTemporaryGraphs();
    await this.deleteTemporaryGraphs(temporaryGraphs);

    // STEP 3: Restore permanent graphs
    const runningGraphs = await this.graphDao.getRunningGraphs();
    const restorationPromises = runningGraphs.map((graph) =>
      this.restoreGraph(graph),
    );
    await Promise.allSettled(restorationPromises);
  }

  /**
   * Cleans up all runtime containers with temporary labels
   * This ensures that any leftover temporary containers from previous runs are removed
   */
  private async cleanupTemporaryRuntimes(): Promise<void> {
    this.logger.log('Cleaning up temporary runtime containers...');

    try {
      await DockerRuntime.cleanupByLabels(
        { 'ai-company/temporary': 'true' },
        { socketPath: environment.dockerSocket },
      );
      this.logger.log('Temporary runtime containers cleanup complete');
    } catch (error) {
      this.logger.warn(
        'Failed to cleanup temporary runtime containers',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * Destroys temporary graphs that were running before server restart
   * Uses the proper destroy pipeline to stop triggers and runtimes
   */
  private async deleteTemporaryGraphs(
    temporaryGraphs: GraphEntity[],
  ): Promise<void> {
    this.logger.log('Destroying temporary graphs', {
      count: temporaryGraphs.length,
      graphIds: temporaryGraphs.map((g) => g.id),
    });

    const deletionPromises = temporaryGraphs.map(async (graph) => {
      try {
        await this.graphCompiler.destroyNotCompiledGraph(graph);
      } catch (error) {
        this.logger.warn(
          `Failed to destroy runtime containers for temporary graph ${graph.id}`,
          {
            graphId: graph.id,
            graphName: graph.name,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      try {
        await this.graphDao.deleteById(graph.id);
      } catch (error) {
        this.logger.warn(
          `Failed to delete temporary graph ${graph.id} from database`,
          {
            graphId: graph.id,
            graphName: graph.name,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    });

    await Promise.allSettled(deletionPromises);

    this.logger.log('Temporary graphs destruction complete');
  }

  /**
   * Restores a single graph by recompiling it and registering it in the registry
   */
  private async restoreGraph(graph: GraphEntity): Promise<void> {
    const { id, name } = graph;

    try {
      // Check if graph is already registered (shouldn't happen, but safety check)
      if (this.graphRegistry.get(id)) {
        return;
      }

      // Compile the graph
      const compiledGraph = await this.graphCompiler.compile(graph);

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
