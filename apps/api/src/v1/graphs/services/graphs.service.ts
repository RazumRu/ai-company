import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isEqual, omit } from 'lodash';
import { coerce, compare as compareSemver } from 'semver';
import { EntityManager } from 'typeorm';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import { GraphRevisionDto } from '../dto/graph-revisions.dto';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GetAllGraphsQueryDto,
  GraphDto,
  GraphNodesQueryDto,
  GraphNodeWithStatusDto,
  UpdateGraphDto,
  UpdateGraphResponseDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import type { GraphRevisionConfig } from '../entity/graph-revision.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRevisionService } from './graph-revision.service';

@Injectable()
export class GraphsService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphRegistry: GraphRegistry,
    private readonly graphRevisionService: GraphRevisionService,
    private readonly typeorm: TypeormService,
    private readonly threadsDao: ThreadsDao,
    private readonly notificationsService: NotificationsService,
    private readonly authContext: AuthContextService,
  ) {}

  private prepareResponse(entity: GraphEntity): GraphDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  async create(data: CreateGraphDto): Promise<GraphDto> {
    // Validate schema before creating the graph
    this.graphCompiler.validateSchema(data.schema);

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const initialVersion = '1.0.0';
      const row = await this.graphDao.create(
        {
          ...data,
          status: GraphStatus.Created,
          createdBy: this.authContext.checkSub(),
          temporary: data.temporary ?? false,
          version: initialVersion,
          targetVersion: initialVersion,
        },
        entityManager,
      );

      return this.prepareResponse(row);
    });
  }

  async findById(id: string): Promise<GraphDto> {
    const graph = await this.graphDao.getOne({
      id,
      createdBy: this.authContext.checkSub(),
    });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    return this.prepareResponse(graph);
  }

  async getAll(query?: GetAllGraphsQueryDto): Promise<GraphDto[]> {
    const row = await this.graphDao.getAll({
      createdBy: this.authContext.checkSub(),
      ...query,
      order: {
        updatedAt: 'DESC',
      },
    });

    return row.map(this.prepareResponse);
  }

  async getCompiledNodes(
    id: string,
    data: GraphNodesQueryDto,
  ): Promise<GraphNodeWithStatusDto[]> {
    const graph = await this.graphDao.getOne({
      id,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const compiledGraph = this.graphRegistry.get(id);
    if (!compiledGraph) {
      throw new BadRequestException(
        'GRAPH_NOT_RUNNING',
        'Graph must be running to inspect compiled nodes',
      );
    }

    return compiledGraph!.state.getSnapshots(data.threadId, data.runId);
  }

  async update(
    id: string,
    data: UpdateGraphDto,
  ): Promise<UpdateGraphResponseDto> {
    const { currentVersion, metadata, schema, name, description, temporary } =
      data;

    // Use transaction with row-level locking to prevent simultaneous updates
    let revisionToEnqueue: Pick<GraphRevisionDto, 'id' | 'graphId'> | null =
      null;

    const response = await this.typeorm.trx(
      async (entityManager: EntityManager) => {
        // Lock the graph row for update (prevents race conditions)
        const graph = await this.graphDao.getOne(
          {
            id: id,
            createdBy: this.authContext.checkSub(),
            lock: 'pessimistic_write',
          },
          entityManager,
        );

        if (!graph) {
          throw new NotFoundException('GRAPH_NOT_FOUND');
        }

        if (graph.version !== currentVersion) {
          throw new BadRequestException(
            'VERSION_CONFLICT',
            `Graph version mismatch. Expected ${currentVersion} but found ${graph.version}`,
          );
        }

        // Invariant repair: targetVersion must never be lower than version.
        // If this happened due to legacy bugs or manual DB edits, clamp it before
        // we compute the revision head (targetVersion) for new revisions.
        if (this.isVersionLess(graph.targetVersion, graph.version)) {
          const updated = await this.graphDao.updateById(
            id,
            { targetVersion: graph.version },
            entityManager,
          );
          if (!updated) {
            throw new NotFoundException('GRAPH_NOT_FOUND');
          }
          graph.targetVersion = updated.targetVersion;
        }

        type GraphUpdateSnapshot = GraphRevisionConfig & {
          metadata?: GraphEntity['metadata'];
        };

        const baseGraph: GraphUpdateSnapshot = {
          schema: graph.schema,
          name: graph.name,
          description: graph.description ?? null,
          temporary: graph.temporary,
          metadata: graph.metadata,
        };

        const nextGraph: GraphUpdateSnapshot = {
          schema: schema ?? baseGraph.schema,
          name: name ?? baseGraph.name,
          description:
            description !== undefined ? description : baseGraph.description,
          temporary: temporary ?? baseGraph.temporary,
          metadata: metadata !== undefined ? metadata : baseGraph.metadata,
        };

        const metadataChanged = !isEqual(
          baseGraph.metadata,
          nextGraph.metadata,
        );

        const revisionRelevantChanged = !isEqual(
          omit(baseGraph, ['metadata']),
          omit(nextGraph, ['metadata']),
        );

        // Metadata is UI-only and is applied immediately (excluded from revisions).
        if (metadataChanged) {
          const updated = await this.graphDao.updateById(
            id,
            { metadata },
            entityManager,
          );
          if (!updated) {
            throw new NotFoundException('GRAPH_NOT_FOUND');
          }
          graph.metadata = updated.metadata;
        }

        if (revisionRelevantChanged) {
          const { metadata: _ignored, ...nextConfig } = nextGraph;
          const revision = await this.graphRevisionService.queueRevision(
            graph,
            currentVersion,
            nextConfig,
            entityManager,
            { enqueueImmediately: false },
          );

          revisionToEnqueue = {
            id: revision.id,
            graphId: revision.graphId,
          };

          // Return updated graph state with the created revision
          graph.targetVersion = revision.toVersion;
          return {
            graph: this.prepareResponse(graph),
            revision,
          };
        }

        // No revision-worthy changes (metadata-only or no-op).
        return { graph: this.prepareResponse(graph) };
      },
    );

    // Enqueue revision processing outside transaction
    if (revisionToEnqueue) {
      await this.graphRevisionService.enqueueRevisionProcessing(
        revisionToEnqueue,
      );
    }

    return response;
  }

  private isVersionLess(a: string, b: string): boolean {
    const av = coerce(a)?.version;
    const bv = coerce(b)?.version;
    if (!av || !bv) {
      // Best-effort: if we cannot parse semver, do not attempt to "fix" it here.
      return false;
    }
    return compareSemver(av, bv) === -1;
  }

  async delete(id: string): Promise<void> {
    const graph = await this.graphDao.getById(id);
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Stop and destroy the graph if it's running
    if (graph.status === GraphStatus.Running) {
      await this.destroy(id);
    }

    await this.graphDao.deleteById(id);
  }

  async run(id: string): Promise<GraphDto> {
    const graph = await this.graphDao.getById(id);
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const registryStatus = this.graphRegistry.getStatus(id);
    const isGraphActive =
      registryStatus === GraphStatus.Running ||
      registryStatus === GraphStatus.Compiling;

    if (isGraphActive) {
      throw new BadRequestException('GRAPH_ALREADY_RUNNING');
    }

    const schema = graph.schema;

    // Update status to compiling
    const compilingUpdate = await this.graphDao.updateById(id, {
      status: GraphStatus.Compiling,
      error: null,
    });

    if (!compilingUpdate) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    await this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId: id,
      data: {
        status: GraphStatus.Compiling,
        schema,
      },
    });

    try {
      // Compile the graph (it will be registered automatically during compilation)
      await this.graphCompiler.compile(graph, {
        graphId: graph.id,
        name: graph.name,
        version: graph.version,
      });

      // Graph is already registered by compiler, no need to register again

      // Update status to running
      const updated = await this.graphDao.updateById(id, {
        status: GraphStatus.Running,
        error: null,
      });

      if (!updated) {
        // If database update fails, cleanup the registry
        await this.graphRegistry.destroy(id);
        throw new NotFoundException('GRAPH_NOT_FOUND');
      }

      await this.notificationsService.emit({
        type: NotificationEvent.Graph,
        graphId: id,
        data: {
          status: GraphStatus.Running,
          schema,
        },
      });

      return this.prepareResponse(updated);
    } catch (error) {
      // Cleanup registry if it was registered
      if (this.graphRegistry.get(id)) {
        await this.graphRegistry.destroy(id);
      }

      try {
        await this.stopRunningThreads(id);
      } catch {
        // Best effort: keep original error as the primary failure reason
      }

      await this.graphDao.updateById(id, {
        status: GraphStatus.Error,
        error: (error as Error).message,
      });

      await this.notificationsService.emit({
        type: NotificationEvent.Graph,
        graphId: id,
        data: {
          status: GraphStatus.Error,
          schema,
        },
      });

      throw error;
    }
  }

  private async stopRunningThreads(graphId: string): Promise<void> {
    const runningThreads = await this.threadsDao.getAll({
      graphId,
      status: ThreadStatus.Running,
    });

    if (!runningThreads.length) {
      return;
    }

    await Promise.allSettled(
      runningThreads.map((thread) =>
        (async () => {
          await this.threadsDao.updateById(thread.id, {
            status: ThreadStatus.Stopped,
          });
        })(),
      ),
    );
  }

  /**
   * Best-effort stop of a single thread execution within a running graph.
   * Stops any active agent runs whose thread_id or parent_thread_id matches the provided externalThreadId.
   */
  async stopThreadExecution(
    graphId: string,
    externalThreadId: string,
    reason?: string,
  ): Promise<boolean> {
    const compiledGraph = this.graphRegistry.get(graphId);
    if (!compiledGraph) {
      return false;
    }

    const agentNodes = this.graphRegistry.getNodesByType<SimpleAgent>(
      graphId,
      NodeKind.SimpleAgent,
    );

    if (!agentNodes.length) {
      return false;
    }

    const results = await Promise.allSettled(
      agentNodes.map(async (node) => {
        await node.instance.stopThread(externalThreadId, reason);
        return true;
      }),
    );

    return results.some((r) => r.status === 'fulfilled' && r.value === true);
  }

  async destroy(id: string): Promise<GraphDto> {
    const graph = await this.graphDao.getById(id);
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Destroy the graph if it's in the registry
    if (this.graphRegistry.get(id)) {
      await this.graphRegistry.destroy(id);
    }

    // Update status to stopped
    const updated = await this.graphDao.updateById(id, {
      status: GraphStatus.Stopped,
      error: null,
    });

    if (!updated) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    await this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId: id,
      data: {
        status: GraphStatus.Stopped,
        schema: graph.schema,
      },
    });

    return this.prepareResponse(updated);
  }

  async executeTrigger(
    graphId: string,
    triggerId: string,
    dto: ExecuteTriggerDto,
  ): Promise<ExecuteTriggerResponseDto> {
    // Verify graph exists and user has access
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Get the compiled graph from registry
    const compiledGraph = this.graphRegistry.get(graphId);
    if (!compiledGraph || compiledGraph.status !== GraphStatus.Running) {
      throw new BadRequestException(
        'GRAPH_NOT_RUNNING',
        'Graph must be running to execute triggers',
      );
    }

    // Get the trigger node
    const triggerNode = this.graphRegistry.getNode<BaseTrigger>(
      graphId,
      triggerId,
    );
    if (!triggerNode) {
      throw new NotFoundException('TRIGGER_NOT_FOUND');
    }

    if (triggerNode.type !== NodeKind.Trigger) {
      throw new BadRequestException(
        'INVALID_NODE_TYPE',
        'Node is not a trigger',
      );
    }

    const trigger = triggerNode.instance;

    // Check if trigger is started
    if (!trigger.isStarted) {
      throw new BadRequestException(
        'TRIGGER_NOT_STARTED',
        'Trigger is not in listening state',
      );
    }

    const messages = dto.messages.map((msg) => new HumanMessage(msg));

    const res = await trigger.invokeAgent(messages, {
      configurable: {
        thread_id: dto.threadSubId,
        async: dto.async,
      },
    });

    return {
      externalThreadId: res.threadId,
      checkpointNs: res.checkpointNs,
    };
  }
}
