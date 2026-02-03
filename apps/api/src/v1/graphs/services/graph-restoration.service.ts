import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';

import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
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
    private readonly graphRegistry: GraphRegistry,
    private readonly threadsDao: ThreadsDao,
    private readonly moduleRef: ModuleRef,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Restores all graphs that were running before server restart
   * Process order:
   * 1. First: Destroy temporary graphs (run destroy pipeline)
   * 2. Finally: Restore permanent graphs
   */
  async restoreRunningGraphs(): Promise<void> {
    this.logger.log('Starting graph restoration process...');

    // Destroy temporary graphs first (run destroy pipeline)
    await this.graphDao.hardDelete({ temporary: true });

    // Restore permanent graphs (both running and compiling)
    const graphsToRestore = await this.graphDao.getAll({
      statuses: [GraphStatus.Running, GraphStatus.Compiling],
    });

    this.logger.debug('Restoring graphs after restart', {
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
      const contextDataStorage = new AuthContextStorage({
        sub: graph.createdBy,
      });
      await graphsService.run(contextDataStorage, id);

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

      // Update thread status (token usage is in checkpoint state only)
      const updatePromises = runningThreads.map(async (thread) => {
        return this.threadsDao.updateById(thread.id, {
          status: ThreadStatus.Stopped,
        });
      });

      await Promise.allSettled(updatePromises);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to stop interrupted threads for graph ${graphId}`,
      );
    }
  }
}
