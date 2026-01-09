import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';

import { ThreadTokenUsageCacheService } from '../../cache/services/thread-token-usage-cache.service';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphsService } from './graphs.service';

/**
 * GraphRestorationService handles restoring graphs with their agent states
 * after server restart. It queries the database for graphs with 'running' status
 * and recompiles them into the GraphRegistry.
 *
 * Note: This service uses ModuleRef to lazily resolve GraphsService to avoid
 * issues with request-scoped providers (AuthContextService) that would prevent
 * onModuleInit from running.
 */
@Injectable()
export class GraphRestorationService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphRegistry: GraphRegistry,
    private readonly threadsDao: ThreadsDao,
    private readonly threadTokenUsageCacheService: ThreadTokenUsageCacheService,
    private readonly moduleRef: ModuleRef,
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
    const temporaryGraphs = await this.graphDao.getAll({ temporary: true });
    await this.deleteTemporaryGraphs(temporaryGraphs);

    // STEP 3: Restore permanent graphs (both running and compiling)
    const graphsToRestore = await this.graphDao.getAll({
      statuses: [GraphStatus.Running, GraphStatus.Compiling],
    });

    this.logger.log('Restoring graphs after restart', {
      runningCount: graphsToRestore.filter(
        (graph) => graph.status === GraphStatus.Running,
      ).length,
      compilingCount: graphsToRestore.filter(
        (graph) => graph.status === GraphStatus.Compiling,
      ).length,
      total: graphsToRestore.length,
    });

    const restorationPromises = graphsToRestore.map((graph) =>
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
      await DockerRuntime.cleanupByLabels({ 'ai-company/temporary': 'true' });
      this.logger.log('Temporary runtime containers cleanup complete');
    } catch (error) {
      this.logger.warn('Failed to cleanup temporary runtime containers', {
        error: error instanceof Error ? error.message : String(error),
      });
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
        await this.cleanupNotCompiledGraphRuntimes(graph);
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
   * Cleans up Docker runtime containers for graphs that were not compiled.
   * Used during temporary graph cleanup after server restart.
   */
  private async cleanupNotCompiledGraphRuntimes(
    graph: GraphEntity,
  ): Promise<void> {
    const runtimeNodes = graph.schema.nodes.filter(
      (node) => node.template === 'docker-runtime',
    );
    if (runtimeNodes.length === 0) return;

    await DockerRuntime.cleanupByLabels({ 'ai-company/graph_id': graph.id });
  }

  /**
   * Restores a single graph by recompiling it and registering it in the registry
   * Uses ModuleRef to lazily resolve GraphsService to avoid request-scoped dependency issues
   */
  private async restoreGraph(graph: GraphEntity): Promise<void> {
    const { id, name } = graph;

    try {
      // Check if graph is already registered (shouldn't happen, but safety check)
      if (this.graphRegistry.get(id)) {
        return;
      }

      // Lazily resolve GraphsService using ModuleRef to avoid request-scoped issues
      const graphsService = await this.moduleRef.create(GraphsService);

      // Use the run method from GraphsService
      await graphsService.run(id);

      // Stop interrupted threads instead of resuming them
      await this.stopInterruptedThreads(id);

      this.logger.log(`Successfully restored graph ${id}`);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to restore graph ${id}`,
        {
          graphId: id,
          graphName: name,
        },
      );
      // Don't re-throw - allow other graphs to be restored
    }
  }

  /**
   * Stops all interrupted threads for a restored graph
   * Threads that were running before server restart are marked as stopped
   * Users can manually restart them if needed
   */
  private async stopInterruptedThreads(graphId: string): Promise<void> {
    try {
      // Get all running threads for this graph
      const runningThreads = await this.threadsDao.getAll({
        graphId,
        status: ThreadStatus.Running,
      });

      if (runningThreads.length === 0) {
        return;
      }

      this.logger.log(
        `Stopping ${runningThreads.length} interrupted thread(s) for graph ${graphId}`,
        {
          graphId,
          threadIds: runningThreads.map((t) => t.externalThreadId),
        },
      );

      // Flush token usage from Redis and update thread status
      const updatePromises = runningThreads.map(async (thread) => {
        const tokenUsage =
          await this.threadTokenUsageCacheService.flushThreadTokenUsage(
            thread.externalThreadId,
          );

        // Merge with existing DB token usage to preserve per-node data across multiple runs
        let mergedTokenUsage = tokenUsage;
        if (tokenUsage && thread.tokenUsage?.byNode && tokenUsage.byNode) {
          const mergedByNode = { ...thread.tokenUsage.byNode };
          for (const [nodeId, usage] of Object.entries(tokenUsage.byNode)) {
            mergedByNode[nodeId] = usage;
          }
          mergedTokenUsage = {
            ...tokenUsage,
            byNode: mergedByNode,
          };
        }

        return this.threadsDao.updateById(thread.id, {
          status: ThreadStatus.Stopped,
          ...(mergedTokenUsage ? { tokenUsage: mergedTokenUsage } : {}),
        });
      });

      await Promise.allSettled(updatePromises);

      this.logger.log(
        `Successfully stopped ${runningThreads.length} interrupted thread(s) for graph ${graphId}`,
      );
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to stop interrupted threads for graph ${graphId}`,
      );
      // Don't throw - graph restoration should succeed even if thread stopping fails
    }
  }
}
