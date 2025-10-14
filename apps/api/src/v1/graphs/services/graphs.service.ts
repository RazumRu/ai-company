import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import {
  BaseCheckpointSaver,
  Checkpoint,
} from '@langchain/langgraph-checkpoint';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { AdditionalParams, TypeormService } from '@packages/typeorm';
import { isUndefined, omitBy } from 'lodash';
import { EntityManager } from 'typeorm';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import {
  GraphCheckpointsDao,
  SearchTerms,
} from '../../agents/dao/graph-checkpoints.dao';
import { GraphCheckpointEntity } from '../../agents/entity/graph-chekpoints.entity';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { GraphDao } from '../dao/graph.dao';
import {
  CreateGraphDto,
  ExecuteTriggerDto,
  GetGraphMessagesQueryDto,
  GraphDto,
  GraphMessagesResponseDto,
  MessageDto,
  ThreadMessagesDto,
  UpdateGraphDto,
} from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';

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
  ) {}

  private prepareResponse(entity: GraphEntity): GraphDto {
    return {
      ...entity,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  async create(data: CreateGraphDto): Promise<GraphDto> {
    return this.typeorm.trx(async (entityManager: EntityManager) => {
      const row = await this.graphDao.create(
        {
          ...data,
          status: GraphStatus.Created,
          createdBy: this.authContext.checkSub(),
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
  ): Promise<void> {
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
    trigger.invokeAgent(messages, {});
  }

  async getNodeMessages(
    graphId: string,
    nodeId: string,
    query: GetGraphMessagesQueryDto,
  ): Promise<GraphMessagesResponseDto> {
    // Verify graph exists and user has access
    const graph = await this.graphDao.getOne({
      id: graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Verify the node exists in the graph schema
    const nodeExists = graph.schema.nodes.some((node) => node.id === nodeId);
    if (!nodeExists) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Node ${nodeId} not found in graph`,
      );
    }

    const checkpointQuery: SearchTerms & AdditionalParams = {
      checkpointNs: `${graphId}:${nodeId}`,
      threadId: query.threadId || graphId,
      order: { createdAt: 'DESC' },
    };

    const checkpoints = await this.graphCheckpointsDao.getAll(checkpointQuery);

    if (checkpoints.length === 0) {
      // No checkpoints found, return empty threads
      return {
        nodeId,
        threads: [],
      };
    }

    // Group checkpoints by threadId and get the latest checkpoint for each thread
    const threadCheckpointsMap = new Map<string, GraphCheckpointEntity>();

    for (const checkpoint of checkpoints) {
      const threadId = checkpoint.threadId;
      if (!threadCheckpointsMap.has(threadId)) {
        threadCheckpointsMap.set(threadId, checkpoint);
      }
    }

    // Process each thread's messages
    const threads: ThreadMessagesDto[] = [];

    for (const [threadId, checkpoint] of threadCheckpointsMap.entries()) {
      // Deserialize the checkpoint to extract messages
      const deserializedCheckpoint: Checkpoint =
        await this.pgCheckpointSaver.serde.loadsTyped(
          checkpoint.type,
          checkpoint.checkpoint.toString('utf8'),
        );

      // Extract messages from the checkpoint channel values
      const messagesChannel =
        deserializedCheckpoint.channel_values?.['messages'];
      let messages: BaseMessage[] = [];

      if (Array.isArray(messagesChannel)) {
        messages = messagesChannel;
      }

      // Apply limit if specified
      if (query.limit && messages.length > query.limit) {
        messages = messages.slice(-query.limit); // Get the last N messages
      }

      // Transform messages to DTOs
      const messageDtos: MessageDto[] = messages.map((msg) =>
        this.transformMessageToDto(msg),
      );

      threads.push({
        id: threadId,
        messages: messageDtos,
        checkpointId: checkpoint.checkpointId,
      });
    }

    return {
      nodeId,
      threads,
    };
  }

  private getMessageRole(msg: BaseMessage): 'human' | 'ai' | 'system' | 'tool' {
    const type = msg.getType();
    switch (type) {
      case 'human':
        return 'human';
      case 'ai':
        return 'ai';
      case 'system':
        return 'system';
      case 'tool':
        return 'tool';
      default:
        return 'ai'; // Default fallback
    }
  }

  private transformMessageToDto(msg: BaseMessage): MessageDto {
    const role = this.getMessageRole(msg);

    // Base message data
    const baseData = {
      role,
      additionalKwargs: msg.additional_kwargs,
    };

    switch (role) {
      case 'human':
        return {
          ...baseData,
          role: 'human',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
        };

      case 'ai': {
        const toolCalls = (msg as any).tool_calls || [];
        return {
          ...baseData,
          role: 'ai',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
          id: msg.id,
          toolCalls: toolCalls.map((tc: any) => ({
            name: tc.name,
            args: tc.args,
            type: tc.type || 'tool_call',
            id: tc.id,
          })),
        };
      }

      case 'system':
        return {
          ...baseData,
          role: 'system',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
        };

      case 'tool': {
        // Parse tool content as JSON
        let parsedContent: Record<string, unknown>;
        try {
          const contentStr =
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
          parsedContent = JSON.parse(contentStr);
        } catch (error) {
          // If parsing fails, wrap the content in an object
          parsedContent = {
            raw: msg.content,
          };
        }

        const toolName = msg.name || 'unknown';

        // Return shell tool message with properly typed content
        if (toolName === 'shell') {
          return {
            ...baseData,
            role: 'tool-shell',
            name: 'shell',
            content: parsedContent as {
              exitCode: number;
              stdout: string;
              stderr: string;
              cmd: string;
              fail?: boolean;
            },
            toolCallId: (msg as any).tool_call_id || '',
          };
        }

        // Return generic tool message
        return {
          ...baseData,
          role: 'tool',
          content: parsedContent,
          name: toolName,
          toolCallId: (msg as any).tool_call_id || '',
        };
      }

      default:
        // Fallback
        return {
          ...baseData,
          role: 'ai',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
        } as MessageDto;
    }
  }
}
