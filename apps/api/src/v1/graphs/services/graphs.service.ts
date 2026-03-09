import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  BadRequestException,
  DefaultLogger,
  NotFoundException,
} from '@packages/common';
import { TypeormService } from '@packages/typeorm';
import { isEqual } from 'lodash';
import { EntityManager } from 'typeorm';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ProjectsDao } from '../../projects/dao/projects.dao';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadStatus } from '../../threads/threads.types';
import { GraphDao } from '../dao/graph.dao';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GetAllGraphsQueryDto,
  GetGraphsPreviewQueryDto,
  GraphDto,
  GraphNodesQueryDto,
  GraphNodeWithStatusDto,
  GraphPreviewDto,
  UpdateGraphDto,
  UpdateGraphResponseDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import type { GraphRevisionConfig } from '../entity/graph-revision.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import {
  extractAgentsFromSchema,
  extractNodeDisplayNamesFromMetadata,
  extractTriggerNodesFromSchema,
} from '../graphs.utils';
import { GRAPH_DELETED_EVENT, GraphDeletedEvent } from '../graphs.events';
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
    private readonly notificationsService: NotificationsService,
    private readonly threadsDao: ThreadsDao,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: DefaultLogger,
    private readonly projectsDao: ProjectsDao,
    private readonly templateRegistry: TemplateRegistry,
  ) {}

  private prepareResponse(
    entity: GraphEntity,
    threadCounts?: { total: number; running: number },
  ): GraphDto {
    return {
      ...entity,
      runningThreads: threadCounts?.running ?? 0,
      totalThreads: threadCounts?.total ?? 0,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  async create(
    ctx: AppContextStorage,
    data: CreateGraphDto,
  ): Promise<GraphDto> {
    // Validate schema before creating the graph
    this.graphCompiler.validateSchema(data.schema);

    const userId = ctx.checkSub();
    const projectId = ctx.checkProjectId();

    const project = await this.projectsDao.getOne({
      id: projectId,
      createdBy: userId,
    });
    if (!project) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const initialVersion = '1.0.0';
      const agents = extractAgentsFromSchema(data.schema, this.templateRegistry);
      const row = await this.graphDao.create(
        {
          ...data,
          projectId,
          status: GraphStatus.Created,
          createdBy: userId,
          temporary: data.temporary ?? false,
          version: initialVersion,
          targetVersion: initialVersion,
          agents,
        },
        entityManager,
      );

      return this.prepareResponse(row);
    });
  }

  async findById(ctx: AppContextStorage, id: string): Promise<GraphDto> {
    const userId = ctx.checkSub();
    const graph = await this.graphDao.getOne({
      id,
      createdBy: userId,
    });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    const threadCounts = await this.threadsDao.countByGraphIds([id]);
    return this.prepareResponse(graph, threadCounts.get(id));
  }

  async getAll(
    ctx: AppContextStorage,
    query?: GetAllGraphsQueryDto,
  ): Promise<GraphDto[]> {
    const userId = ctx.checkSub();
    const rows = await this.graphDao.getAll({
      createdBy: userId,
      ids: query?.ids,
      projectId: ctx.checkProjectId(),
      order: {
        updatedAt: 'DESC',
      },
    });

    const graphIds = rows.map((r) => r.id);
    const threadCounts = await this.threadsDao.countByGraphIds(graphIds);

    return rows.map((entity) =>
      this.prepareResponse(entity, threadCounts.get(entity.id)),
    );
  }

  async getGraphsPreview(
    ctx: AppContextStorage,
    query?: GetGraphsPreviewQueryDto,
  ): Promise<GraphPreviewDto[]> {
    const userId = ctx.checkSub();
    const rows = await this.graphDao.getPreview({
      createdBy: userId,
      ids: query?.ids,
      projectId: ctx.checkProjectId(),
      order: { updatedAt: 'DESC' },
    });

    if (rows.length === 0) return [];

    const graphIds = rows.map((r) => r.id);
    const [schemaMetadataMap, threadCounts] = await Promise.all([
      this.graphDao.getSchemaAndMetadata(graphIds),
      this.threadsDao.countByGraphIds(graphIds),
    ]);

    return rows.map((entity) => {
      const schemaData = schemaMetadataMap.get(entity.id);
      const schema = schemaData?.schema ?? { nodes: [], edges: [] };
      const metadata = schemaData?.metadata ?? null;
      const agents = schemaData?.agents ?? [];
      const counts = threadCounts.get(entity.id);

      return {
        id: entity.id,
        name: entity.name,
        description: entity.description ?? null,
        error: entity.error ?? null,
        version: entity.version,
        targetVersion: entity.targetVersion,
        status: entity.status,
        runningThreads: counts?.running ?? 0,
        totalThreads: counts?.total ?? 0,
        nodeCount: schema.nodes.length,
        edgeCount: schema.edges?.length ?? 0,
        agents,
        triggerNodes: extractTriggerNodesFromSchema(
          schema,
          metadata,
          this.templateRegistry,
        ),
        nodeDisplayNames: extractNodeDisplayNamesFromMetadata(metadata),
        createdAt: new Date(entity.createdAt).toISOString(),
        updatedAt: new Date(entity.updatedAt).toISOString(),
        temporary: entity.temporary,
        projectId: entity.projectId,
      };
    });
  }

  async getCompiledNodes(
    ctx: AppContextStorage,
    id: string,
    data: GraphNodesQueryDto,
  ): Promise<GraphNodeWithStatusDto[]> {
    const userId = ctx.checkSub();
    const graph = await this.graphDao.getOne({
      id,
      createdBy: userId,
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

    return compiledGraph.state.getSnapshots(data.threadId, data.runId);
  }

  async update(
    ctx: AppContextStorage,
    id: string,
    data: UpdateGraphDto,
  ): Promise<UpdateGraphResponseDto> {
    const userId = ctx.checkSub();
    const { currentVersion, metadata, schema, name, description, temporary } =
      data;

    // Use transaction with row-level locking to prevent simultaneous updates.
    // Post-transaction data (revision to enqueue, notification to emit) is returned
    // from the transaction callback so TypeScript can track it through control flow.
    const { response, postCommit } = await this.typeorm.trx(
      async (entityManager: EntityManager) => {
        // Lock the graph row for update (prevents race conditions)
        const graph = await this.graphDao.getOne(
          {
            id: id,
            createdBy: userId,
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
        if (
          this.graphRevisionService.isVersionLess(
            graph.targetVersion,
            graph.version,
          )
        ) {
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

        // --- Synchronous (in-place) fields: metadata, name, description, temporary ---
        // These are simple scalar fields that don't affect the compiled graph and
        // can be applied immediately without going through the revision pipeline.
        const syncUpdates: Partial<GraphEntity> = {};

        if (metadata !== undefined && !isEqual(metadata, graph.metadata)) {
          syncUpdates.metadata = metadata;
        }
        if (name !== undefined && name !== graph.name) {
          syncUpdates.name = name;
        }
        if (
          description !== undefined &&
          (description ?? null) !== (graph.description ?? null)
        ) {
          syncUpdates.description = description ?? undefined;
        }
        if (
          temporary !== undefined &&
          temporary !== null &&
          temporary !== graph.temporary
        ) {
          syncUpdates.temporary = temporary;
        }

        if (Object.keys(syncUpdates).length > 0) {
          const updated = await this.graphDao.updateById(
            id,
            syncUpdates,
            entityManager,
          );
          if (!updated) {
            throw new NotFoundException('GRAPH_NOT_FOUND');
          }
          Object.assign(graph, syncUpdates);
        }

        // --- Revision-relevant field: schema ---
        // Schema changes require async processing (compilation, live-update, etc.)
        const schemaChanged =
          schema !== undefined && !isEqual(schema, graph.schema);

        if (schemaChanged) {
          const revisionConfig: GraphRevisionConfig = {
            schema: schema!,
            name: graph.name,
            description: graph.description ?? null,
            temporary: graph.temporary,
          };

          const revision = await this.graphRevisionService.queueRevision(
            ctx,
            graph,
            currentVersion,
            revisionConfig,
            entityManager,
            { enqueueImmediately: false },
          );

          // Return updated graph state with the created revision
          graph.targetVersion = revision.toVersion;
          return {
            response: {
              graph: this.prepareResponse(graph),
              revision,
            } as UpdateGraphResponseDto,
            postCommit: {
              revisionToEnqueue: { id: revision.id, graphId: revision.graphId },
              revisionEntity: revision.entity,
              graphId: graph.id,
            },
          };
        }

        // No schema change (sync-only or no-op).
        return {
          response: {
            graph: this.prepareResponse(graph),
          } as UpdateGraphResponseDto,
          postCommit: null,
        };
      },
    );

    // Post-transaction: emit notification and enqueue processing.
    // These run after the transaction commits so the enrichment handler
    // can read the committed revision data from the database.
    if (postCommit) {
      await this.notificationsService.emit({
        type: NotificationEvent.GraphRevisionCreate,
        graphId: postCommit.graphId,
        data: postCommit.revisionEntity,
      });

      await this.graphRevisionService.enqueueRevisionProcessing(
        postCommit.revisionToEnqueue,
      );
    }

    return response;
  }

  async delete(ctx: AppContextStorage, id: string): Promise<void> {
    const userId = ctx.checkSub();
    const graph = await this.graphDao.getOne({
      id,
      createdBy: userId,
    });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Stop and destroy the graph if it's running
    if (graph.status === GraphStatus.Running) {
      await this.destroy(ctx, id);
    }

    await this.eventEmitter.emitAsync(
      GRAPH_DELETED_EVENT,
      { graphId: id, userId } satisfies GraphDeletedEvent,
    );

    await this.graphDao.deleteById(id);
  }

  async run(ctx: AppContextStorage, id: string): Promise<GraphDto> {
    const userId = ctx.checkSub();
    const graph = await this.graphDao.getOne({
      id,
      createdBy: userId,
    });
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

    await this.emitGraphPreview(id, GraphStatus.Compiling, graph);

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

      await this.emitGraphPreview(id, GraphStatus.Running, graph);

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

      await this.emitGraphPreview(id, GraphStatus.Error, graph);

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
        this.threadsDao.updateById(thread.id, {
          status: ThreadStatus.Stopped,
        }),
      ),
    );
  }

  private async emitGraphPreview(
    id: string,
    status: GraphStatus,
    graph: GraphEntity,
  ): Promise<void> {
    const schema = graph.schema;
    await this.notificationsService.emit({
      type: NotificationEvent.GraphPreview,
      graphId: id,
      data: {
        id,
        status,
        triggerNodes: extractTriggerNodesFromSchema(
          schema,
          graph.metadata,
          this.templateRegistry,
        ),
        nodeDisplayNames: extractNodeDisplayNamesFromMetadata(graph.metadata),
        nodeCount: schema.nodes.length,
        edgeCount: schema.edges?.length ?? 0,
        agents: graph.agents ?? [],
        version: graph.version,
        targetVersion: graph.targetVersion,
        error: graph.error ?? null,
      },
    });
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

  async destroy(ctx: AppContextStorage, id: string): Promise<GraphDto> {
    const userId = ctx.checkSub();
    const graph = await this.graphDao.getOne({
      id,
      createdBy: userId,
    });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Destroy the graph if it's in the registry
    if (this.graphRegistry.get(id)) {
      await this.graphRegistry.destroy(id);
    }

    // Safety net: stop any threads still marked as running in the database.
    try {
      await this.stopRunningThreads(id);
    } catch {
      // Best effort: keep destroy flowing even if thread cleanup fails
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

    await this.emitGraphPreview(id, GraphStatus.Stopped, graph);

    return this.prepareResponse(updated);
  }

  async executeTrigger(
    ctx: AppContextStorage,
    graphId: string,
    triggerId: string,
    dto: ExecuteTriggerDto,
  ): Promise<ExecuteTriggerResponseDto> {
    const userId = ctx.checkSub();
    // Verify graph exists and user has access
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: userId,
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

    if (!trigger.invokeAgent) {
      throw new BadRequestException(
        'TRIGGER_NOT_CONFIGURED',
        'Agent invocation function not set on trigger',
      );
    }

    const res = await trigger.invokeAgent(messages, {
      configurable: {
        thread_id: dto.threadSubId,
        async: dto.async,
        thread_metadata: dto.metadata,
      },
    });

    const externalThreadId = res.threadId;

    // Eagerly create thread to avoid race condition with async notification handler.
    // The handler's check-then-create pattern will find this thread and enter the update path.
    const existingThread = await this.threadsDao.getOne({
      externalThreadId,
      graphId,
    });
    if (!existingThread) {
      try {
        await this.threadsDao.create({
          graphId,
          createdBy: userId,
          projectId: graph.projectId,
          externalThreadId,
          status: ThreadStatus.Running,
          ...(dto.metadata ? { metadata: dto.metadata } : {}),
        });
      } catch (error: unknown) {
        const isUniqueViolation =
          error instanceof Error &&
          'code' in error &&
          (error as { code: string }).code === '23505';
        if (isUniqueViolation) {
          this.logger.debug(
            `Eager thread creation skipped (race with notification handler): ${error instanceof Error ? error.message : String(error)}`,
          );
        } else {
          this.logger.warn(
            `Eager thread creation failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Don't rethrow — the notification handler will create the thread as a fallback.
          // But log at warn level so it's visible in production.
        }
      }
    }

    return {
      externalThreadId,
      checkpointNs: res.checkpointNs,
    };
  }
}
