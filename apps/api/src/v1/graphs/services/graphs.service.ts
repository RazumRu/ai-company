import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isEqual, isUndefined, omitBy } from 'lodash';
import { EntityManager } from 'typeorm';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { GraphDao } from '../dao/graph.dao';
import { GraphRevisionDto } from '../dto/graph-revisions.dto';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GraphDto,
  GraphNodesQueryDto,
  GraphNodeWithStatusDto,
  UpdateGraphDto,
  UpdateGraphResponseDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
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

  async getAll(): Promise<GraphDto[]> {
    const row = await this.graphDao.getAll({
      createdBy: this.authContext.checkSub(),
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

    return compiledGraph.state.getSnapshots(data.threadId, data.runId);
  }

  async update(
    id: string,
    data: UpdateGraphDto,
  ): Promise<UpdateGraphResponseDto> {
    const { currentVersion, schema, ...rest } = data;

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

        // If schema is being updated and graph is running or compiling, queue the update
        const schemaChanged = schema ? !isEqual(schema, graph.schema) : false;

        if (
          schema &&
          (graph.status === GraphStatus.Running ||
            graph.status === GraphStatus.Compiling)
        ) {
          this.graphCompiler.validateSchema(schema);

          if (schemaChanged) {
            // Apply non-schema updates immediately (e.g., name, description)
            const nonSchemaUpdates = omitBy({ ...rest }, isUndefined);
            if (Object.keys(nonSchemaUpdates).length > 0) {
              await this.graphDao.updateById(
                id,
                nonSchemaUpdates,
                entityManager,
              );
              // Refresh graph entity with updated fields
              const refreshedGraph = await this.graphDao.getById(id);
              if (!refreshedGraph) {
                throw new NotFoundException('GRAPH_NOT_FOUND');
              }
              Object.assign(graph, refreshedGraph);
            }

            // Queue the schema update for live application with 3-way merge
            // Note: Version will be incremented when the revision is applied, not now
            // currentVersion is used both for validation (above) and as the base for the 3-way merge
            const revision = await this.graphRevisionService.queueRevision(
              graph,
              currentVersion,
              schema,
              entityManager,
              { enqueueImmediately: false },
            );

            revisionToEnqueue = {
              id: revision.id,
              graphId: revision.graphId,
            };

            // Return updated graph state with the created revision
            return {
              graph: this.prepareResponse(graph),
              revision,
            };
          }
        }

        const newVersion = schemaChanged
          ? this.graphRevisionService.generateNextVersion(graph.version)
          : undefined;

        const updatePayload = omitBy(
          {
            ...rest,
            ...(schemaChanged && newVersion
              ? {
                  schema,
                  version: newVersion,
                  targetVersion: newVersion,
                }
              : {}),
          },
          isUndefined,
        );

        if (Object.keys(updatePayload).length === 0) {
          return { graph: this.prepareResponse(graph) };
        }

        const updated = await this.graphDao.updateById(
          id,
          updatePayload,
          entityManager,
        );

        if (!updated) {
          throw new NotFoundException('GRAPH_NOT_FOUND');
        }

        return { graph: this.prepareResponse(updated) };
      },
    );

    if (revisionToEnqueue) {
      await this.graphRevisionService.enqueueRevisionProcessing(
        revisionToEnqueue,
      );
    }

    return response;
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
      const _compiledGraph = await this.graphCompiler.compile(graph, {
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
    if (!compiledGraph) {
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
