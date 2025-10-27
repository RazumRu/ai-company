import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isUndefined, omitBy } from 'lodash';
import { EntityManager } from 'typeorm';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { GraphDao } from '../dao/graph.dao';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  ExecuteTriggerResponseDto,
  GraphDto,
  UpdateGraphDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { MessageTransformerService } from './message-transformer.service';

@Injectable()
export class GraphsService {
  constructor(
    private readonly graphDao: GraphDao,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphRegistry: GraphRegistry,
    private readonly typeorm: TypeormService,
    private readonly authContext: AuthContextService,
    private readonly graphCheckpointsDao: GraphCheckpointsDao,
    private readonly pgCheckpointSaver: PgCheckpointSaver,
    private readonly messageTransformer: MessageTransformerService,
  ) {}

  private prepareResponse(entity: GraphEntity): GraphDto {
    return {
      ...entity,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  async create(data: CreateGraphDto): Promise<GraphDto> {
    // Validate schema before creating the graph
    this.graphCompiler.validateSchema(data.schema);

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const row = await this.graphDao.create(
        {
          ...data,
          status: GraphStatus.Created,
          createdBy: this.authContext.checkSub(),
          temporary: data.temporary ?? false,
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

  async update(id: string, data: UpdateGraphDto): Promise<GraphDto> {
    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const updated = await this.graphDao.updateById(
        id,
        omitBy(data, isUndefined),
        {
          createdBy: this.authContext.checkSub(),
        },
        entityManager,
      );

      if (!updated) {
        throw new NotFoundException('GRAPH_NOT_FOUND');
      }

      return this.prepareResponse(updated);
    });
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

    // Check if graph is already running
    if (this.graphRegistry.get(id)) {
      throw new BadRequestException('GRAPH_ALREADY_RUNNING');
    }

    try {
      // Compile the graph
      const compiledGraph = await this.graphCompiler.compile(graph, {
        graphId: graph.id,
        name: graph.name,
        version: graph.version,
      });

      // Register the compiled graph in the registry
      this.graphRegistry.register(id, compiledGraph);

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

      return this.prepareResponse(updated);
    } catch (error) {
      // Cleanup registry if it was registered
      if (this.graphRegistry.get(id)) {
        await this.graphRegistry.destroy(id);
      }

      await this.graphDao.updateById(id, {
        status: GraphStatus.Error,
        error: (<Error>error).message,
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

    const updated = await this.graphDao.updateById(id, {
      status: GraphStatus.Stopped,
    });

    if (!updated) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

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
      },
    });

    return {
      threadId: res.threadId,
      checkpointNs: res.checkpointNs,
    };
  }
}
