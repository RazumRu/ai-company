import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { GraphCheckpointEntity } from '../../agents/entity/graph-chekpoints.entity';
import { SimpleAgentSchemaType } from '../../agents/services/agents/simple-agent';
import { SimpleAgentTemplateResult } from '../../graph-templates/templates/base-node.template';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphEntity } from '../entity/graph.entity';
import { CompiledGraphNode, GraphStatus, NodeKind } from '../graphs.types';
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
    private readonly threadsDao: ThreadsDao,
    private readonly graphCheckpointsDao: GraphCheckpointsDao,
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

      // Resume interrupted threads
      await this.resumeInterruptedThreads(id);

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

      // Update graph status to error in database
      await this.graphDao.updateById(id, {
        status: GraphStatus.Error,
        error: `Restoration failed: ${(error as Error).message}`,
      });

      throw error;
    }
  }

  /**
   * Resumes all interrupted threads for a restored graph
   * This allows agents to continue their work from where they left off before server restart
   */
  private async resumeInterruptedThreads(graphId: string): Promise<void> {
    try {
      // Get all running threads for this graph
      const runningThreads = await this.threadsDao.getAll({
        graphId,
        status: ThreadStatus.Running,
      });

      if (runningThreads.length === 0) {
        this.logger.log(
          `No interrupted threads to resume for graph ${graphId}`,
        );
        return;
      }

      this.logger.log(
        `Found ${runningThreads.length} interrupted threads to resume for graph ${graphId}`,
        { threadIds: runningThreads.map((t) => t.externalThreadId) },
      );

      const compiledGraph = this.graphRegistry.get(graphId);
      if (!compiledGraph) {
        this.logger.warn(
          `Cannot resume threads: Graph ${graphId} not found in registry`,
        );
        return;
      }

      // Resume each thread
      const resumePromises = runningThreads.map((thread) =>
        this.resumeThread(graphId, thread.externalThreadId, compiledGraph),
      );

      await Promise.allSettled(resumePromises);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Failed to resume interrupted threads for graph ${graphId}`,
      );
      // Don't throw - graph restoration should succeed even if thread resumption fails
    }
  }

  /**
   * Resumes a single thread by invoking the agent to continue from its last checkpoint
   */
  private async resumeThread(
    graphId: string,
    externalThreadId: string,
    compiledGraph: ReturnType<GraphRegistry['get']>,
  ): Promise<void> {
    try {
      if (!compiledGraph) {
        this.logger.warn(`Cannot resume thread: Graph not found`);
        return;
      }

      const threadIdParts = externalThreadId.split(':');
      if (threadIdParts.length < 2) {
        this.logger.warn(
          `Invalid thread ID format: ${externalThreadId}, cannot resume`,
        );
        return;
      }

      let checkpointNs: string | undefined;
      let checkpointId: string | undefined;
      let agentNodeId: string | null = null;
      let checkpoints: GraphCheckpointEntity[] = [];

      try {
        checkpoints = await this.graphCheckpointsDao.getAll({
          threadId: externalThreadId,
          order: { createdAt: 'DESC' },
          limit: 20,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to load checkpoint metadata for thread ${externalThreadId}`,
          {
            graphId,
            threadId: externalThreadId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }

      const latestCheckpoint = this.findLatestAgentCheckpoint(
        checkpoints,
        compiledGraph,
      );

      if (latestCheckpoint) {
        checkpointNs = latestCheckpoint.checkpointNs;
        checkpointId = latestCheckpoint.checkpointId;
        agentNodeId = latestCheckpoint.agentNodeId;
      }

      if (!agentNodeId) {
        const threadSubId = threadIdParts.slice(1).join(':');
        const nodeIdMatch = threadSubId.match(/__([^_]+)$/);
        if (nodeIdMatch?.[1]) {
          agentNodeId = nodeIdMatch[1];
        }
      }

      if (!agentNodeId) {
        for (const [nodeId, node] of compiledGraph.nodes.entries()) {
          if (node.type === NodeKind.SimpleAgent) {
            agentNodeId = nodeId;
            break;
          }
        }
      }

      if (!agentNodeId) {
        this.logger.warn(
          `No agent node found to resume thread ${externalThreadId}`,
        );
        return;
      }

      if (!checkpointNs && agentNodeId) {
        const matchingCheckpoint = checkpoints.find((cp) => {
          const ns = cp.checkpointNs?.trim();
          if (!ns) return false;
          return this.extractNodeIdFromCheckpointNs(ns) === agentNodeId;
        });
        if (matchingCheckpoint) {
          checkpointNs = matchingCheckpoint.checkpointNs?.trim();
          checkpointId = matchingCheckpoint.checkpointId || undefined;
        }
      }

      if (!checkpointNs) {
        this.logger.warn(
          `No checkpoint namespace found for thread ${externalThreadId}, skipping resume`,
          {
            graphId,
            nodeId: agentNodeId,
            threadId: externalThreadId,
          },
        );
        return;
      }

      const agentNode = compiledGraph.nodes.get(agentNodeId);
      if (!agentNode || agentNode.type !== NodeKind.SimpleAgent) {
        this.logger.warn(
          `Agent node ${agentNodeId} not found or invalid type for thread ${externalThreadId}`,
        );
        return;
      }

      const simpleAgentNode = agentNode as CompiledGraphNode<
        SimpleAgentTemplateResult<SimpleAgentSchemaType>
      >;
      const agent = simpleAgentNode.instance?.agent;
      const agentConfig = simpleAgentNode.instance?.config;

      if (!agent || !agentConfig) {
        this.logger.warn(
          `Agent instance not available for node ${agentNodeId}, thread ${externalThreadId}`,
        );
        return;
      }

      this.logger.log(
        `Resuming thread ${externalThreadId} on agent node ${agentNodeId}`,
        {
          graphId,
          nodeId: agentNodeId,
          threadId: externalThreadId,
          checkpointNs,
          checkpointId,
        },
      );

      // Resume the agent with empty messages to continue from checkpoint
      // LangGraph will automatically load from the last checkpoint and continue
      void agent
        .run(externalThreadId, [], agentConfig, {
          configurable: {
            graph_id: graphId,
            node_id: agentNodeId,
            parent_thread_id: externalThreadId,
            thread_id: externalThreadId,
            source: 'graph-restoration',
            checkpoint_ns: checkpointNs,
            async: true,
            ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
          },
        })
        .catch((error: Error) => {
          this.logger.error(
            error,
            `Failed to resume thread ${externalThreadId}`,
            {
              graphId,
              nodeId: agentNodeId,
              threadId: externalThreadId,
            },
          );
        });
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        `Error resuming thread ${externalThreadId}`,
        {
          graphId,
          threadId: externalThreadId,
        },
      );
    }
  }

  private findLatestAgentCheckpoint(
    checkpoints: GraphCheckpointEntity[],
    compiledGraph: ReturnType<GraphRegistry['get']>,
  ):
    | { checkpointNs: string; checkpointId?: string; agentNodeId: string }
    | undefined {
    if (!compiledGraph) {
      return undefined;
    }

    for (const cp of checkpoints) {
      const ns = cp.checkpointNs?.trim();
      if (!ns) continue;

      const agentNodeId = this.extractNodeIdFromCheckpointNs(ns);
      if (!agentNodeId) continue;

      const node = compiledGraph.nodes.get(agentNodeId);
      if (node?.type === NodeKind.SimpleAgent) {
        return {
          checkpointNs: ns,
          checkpointId: cp.checkpointId || undefined,
          agentNodeId,
        };
      }
    }

    return undefined;
  }

  private extractNodeIdFromCheckpointNs(ns?: string | null): string | null {
    if (!ns) return null;
    const segments = ns.split(':');
    if (segments.length === 0) return null;
    const candidate = segments[segments.length - 1];
    return candidate && candidate.length > 0 ? candidate : null;
  }
}
