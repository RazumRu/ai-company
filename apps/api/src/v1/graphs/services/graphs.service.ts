import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { TypeormService } from '@packages/typeorm';
import { isUndefined, omitBy } from 'lodash';
import { EntityManager } from 'typeorm';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { GraphDao } from '../dao/graph.dao';
import { CreateGraphDto, GraphDto, UpdateGraphDto } from '../dto/graphs.dto';
import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
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
      const compiledGraph = await this.graphCompiler.compile(graph.schema);

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
}
