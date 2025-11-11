import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  DefaultLogger,
  NotFoundException,
} from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import type { AdditionalParams } from '@packages/typeorm';
import { TypeormService } from '@packages/typeorm';
import { compare, type Operation } from 'fast-json-patch';
import { coerce, inc } from 'semver';
import { EntityManager } from 'typeorm';

import {
  SimpleAgent,
  SimpleAgentSchemaType,
} from '../../agents/services/agents/simple-agent';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { GraphDao } from '../dao/graph.dao';
import {
  GraphRevisionDao,
  SearchTerms as GraphRevisionSearchTerms,
} from '../dao/graph-revision.dao';
import {
  GraphRevisionDto,
  GraphRevisionQueryDto,
} from '../dto/graph-revisions.dto';
import { GraphEntity } from '../entity/graph.entity';
import { GraphRevisionEntity } from '../entity/graph-revision.entity';
import {
  CompiledGraphNode,
  GraphRevisionStatus,
  GraphSchemaType,
  GraphStatus,
  NodeKind,
} from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphRevisionQueueService } from './graph-revision-queue.service';

@Injectable()
export class GraphRevisionService {
  constructor(
    private readonly graphRevisionDao: GraphRevisionDao,
    private readonly graphDao: GraphDao,
    private readonly graphRevisionQueue: GraphRevisionQueueService,
    private readonly graphRegistry: GraphRegistry,
    private readonly graphCompiler: GraphCompiler,
    private readonly typeorm: TypeormService,
    private readonly notificationsService: NotificationsService,
    private readonly authContext: AuthContextService,
    private readonly logger: DefaultLogger,
    private readonly templateRegistry: TemplateRegistry,
  ) {
    // Set the processor for the queue
    this.graphRevisionQueue.setProcessor(this.applyRevision.bind(this));
  }

  /**
   * Calculate the diff between two schemas using fast-json-patch library
   */
  private calculateDiff(
    oldSchema: GraphSchemaType,
    newSchema: GraphSchemaType,
  ): Operation[] {
    return compare(oldSchema, newSchema);
  }

  /**
   * Queue a graph revision
   */
  async queueRevision(
    graph: GraphEntity,
    newSchema: GraphSchemaType,
  ): Promise<GraphRevisionDto> {
    const userId = this.authContext.checkSub();

    return this.typeorm.trx(async (entityManager: EntityManager) => {
      // Validate new schema
      this.graphCompiler.validateSchema(newSchema);

      // Calculate diff
      const configurationDiff = this.calculateDiff(graph.schema, newSchema);
      const newVersion = this.generateNextVersion(graph.version);

      // Create revision entity
      const revision = await this.graphRevisionDao.create(
        {
          graphId: graph.id,
          fromVersion: graph.version,
          toVersion: newVersion,
          configurationDiff,
          newSchema,
          status: GraphRevisionStatus.Pending,
          createdBy: userId,
        },
        entityManager,
      );

      // Emit notification
      await this.notificationsService.emit({
        type: NotificationEvent.GraphRevisionCreate,
        graphId: graph.id,
        data: revision,
      });

      // Add to queue
      await this.graphRevisionQueue.addRevision(revision);

      return this.prepareResponse(revision);
    });
  }

  /**
   * Apply a queued revision
   */
  private async applyRevision(jobData: GraphRevisionEntity): Promise<void> {
    // Load full revision entity
    const revision = await this.graphRevisionDao.getById(jobData.id);
    if (!revision) {
      throw new NotFoundException('GRAPH_REVISION_NOT_FOUND');
    }

    try {
      // Re-validate version before applying (CRITICAL: prevents race conditions)
      await this.typeorm.trx(async (entityManager) => {
        // Update status to applying inside the transaction
        await this.graphRevisionDao.updateById(
          revision.id,
          {
            status: GraphRevisionStatus.Applying,
          },
          {},
          entityManager,
        );

        await this.notificationsService.emit({
          type: NotificationEvent.GraphRevisionApplying,
          graphId: revision.graphId,
          data: { ...revision, status: GraphRevisionStatus.Applying },
        });

        const graph = await this.graphDao.getOne(
          { id: revision.graphId },
          entityManager,
        );

        if (!graph) {
          throw new NotFoundException('GRAPH_NOT_FOUND');
        }

        // Check if graph version still matches the revision's fromVersion
        if (graph.version !== revision.fromVersion) {
          throw new BadRequestException(
            'VERSION_CONFLICT',
            `Expected version ${revision.fromVersion} but graph is at ${graph.version}`,
          );
        }

        const compiledGraph = this.graphRegistry.get(revision.graphId);
        const isRunning =
          !!compiledGraph && graph.status === GraphStatus.Running;

        // Handle non-running graphs
        if (!isRunning) {
          this.logger.warn(
            `Graph ${revision.graphId} is not running. Skipping live update but marking revision as applied.`,
          );

          // Update graph entity with new schema and version
          await this.graphDao.updateById(
            revision.graphId,
            {
              schema: revision.newSchema,
              version: revision.toVersion,
            },
            entityManager,
          );

          // Mark revision as applied
          await this.graphRevisionDao.updateById(
            revision.id,
            {
              status: GraphRevisionStatus.Applied,
            },
            {},
            entityManager,
          );

          await this.notificationsService.emit({
            type: NotificationEvent.GraphRevisionApplied,
            graphId: revision.graphId,
            data: {
              ...revision,
              status: GraphRevisionStatus.Applied,
            },
          });

          return;
        }

        if (compiledGraph) {
          // Apply live revision
          await this.applyLiveUpdate(graph, revision, compiledGraph);

          // Update graph entity with new schema and version
          await this.graphDao.updateById(
            revision.graphId,
            {
              schema: revision.newSchema,
              version: revision.toVersion,
            },
            entityManager,
          );

          // Mark revision as applied
          await this.graphRevisionDao.updateById(
            revision.id,
            {
              status: GraphRevisionStatus.Applied,
            },
            {},
            entityManager,
          );

          await this.notificationsService.emit({
            type: NotificationEvent.GraphRevisionApplied,
            graphId: revision.graphId,
            data: {
              ...revision,
              status: GraphRevisionStatus.Applied,
            },
          });

          this.logger.log(`Successfully applied graph revision ${revision.id}`);
        }
      });
    } catch (error) {
      this.logger.error(
        error as Error,
        `Failed to apply graph revision ${revision.id}`,
      );

      await this.graphRevisionDao.updateById(revision.id, {
        status: GraphRevisionStatus.Failed,
        error: (error as Error).message,
      });

      await this.notificationsService.emit({
        type: NotificationEvent.GraphRevisionFailed,
        graphId: revision.graphId,
        data: {
          ...revision,
          status: GraphRevisionStatus.Failed,
          error: (error as Error).message,
        },
      });

      throw error;
    }
  }

  /**
   * Apply revision to a running graph without stopping it
   * This replaces the entire compiled graph with the new schema
   */
  private async applyLiveUpdate(
    graph: GraphEntity,
    revision: GraphRevisionEntity,
    compiledGraph: ReturnType<typeof this.graphRegistry.get>,
  ): Promise<void> {
    if (!compiledGraph) return;

    this.logger.log(`Applying live revision to graph ${graph.id}`);
    this.logger.log(
      `Configuration diff: ${JSON.stringify(revision.configurationDiff)}`,
    );

    // For now, we recompile the entire graph with the new schema
    // The diff is stored for auditing purposes
    // Future optimization: Apply incremental changes based on the diff

    const metadata = {
      graphId: graph.id,
      name: graph.name,
      version: revision.toVersion,
      temporary: graph.temporary,
    };

    // Get old node IDs for cleanup
    const oldNodeIds = new Set(compiledGraph.nodes.keys());
    const newNodeIds = new Set(
      revision.newSchema.nodes.map((n: { id: string }) => n.id),
    );

    // Store old edges before updating them
    const oldEdges = compiledGraph.edges || [];

    // Step 1: Remove nodes that are no longer in the schema
    for (const nodeId of oldNodeIds) {
      if (!newNodeIds.has(nodeId)) {
        this.logger.log(`Removing node ${nodeId} from graph ${graph.id}`);
        const node = compiledGraph.nodes.get(nodeId);
        if (node) {
          await this.graphCompiler.destroyNode(node);
        }
        compiledGraph.nodes.delete(nodeId);
        compiledGraph.state.unregisterNode(nodeId);
      }
    }

    // Step 2: Update edges
    compiledGraph.edges = revision.newSchema.edges || [];

    // Step 3: Add or revision nodes in topological order
    // This ensures dependencies are created before nodes that depend on them
    const buildOrder = this.graphCompiler.getBuildOrder(revision.newSchema);

    for (const nodeSchema of buildOrder) {
      const existingNode = compiledGraph.nodes.get(
        nodeSchema.id,
      ) as CompiledGraphNode<SimpleAgent>;

      // Check if edges (connections) have changed for this node
      const oldIncomingEdges = oldEdges.filter((e) => e.to === nodeSchema.id);
      const oldOutgoingEdges = oldEdges.filter((e) => e.from === nodeSchema.id);
      const newIncomingEdges =
        revision.newSchema.edges?.filter((e) => e.to === nodeSchema.id) || [];
      const newOutgoingEdges =
        revision.newSchema.edges?.filter((e) => e.from === nodeSchema.id) || [];

      const edgesChanged =
        JSON.stringify(oldIncomingEdges.sort()) !==
          JSON.stringify(newIncomingEdges.sort()) ||
        JSON.stringify(oldOutgoingEdges.sort()) !==
          JSON.stringify(newOutgoingEdges.sort());

      // If node exists and neither config nor edges have changed, skip
      if (
        existingNode &&
        JSON.stringify(existingNode.config) ===
          JSON.stringify(nodeSchema.config) &&
        !edgesChanged
      ) {
        continue;
      }

      this.logger.log(
        `${existingNode ? 'Updating' : 'Adding'} node ${nodeSchema.id} in graph ${graph.id}`,
      );

      const template = this.templateRegistry.getTemplate(nodeSchema.template);
      if (!template) {
        throw new BadRequestException(
          'GRAPH_TEMPLATE_NOT_FOUND',
          `Template '${nodeSchema.template}' not found`,
        );
      }

      // If edges changed, we need to recreate the node to rebuild connections
      if (edgesChanged && existingNode) {
        this.logger.log(
          `Edges changed for node ${nodeSchema.id}, recreating to rebuild connections`,
        );
      }

      // Validate the config before recreating/creating the node
      const validatedConfig = this.templateRegistry.validateTemplateConfig(
        nodeSchema.template,
        nodeSchema.config,
      );

      // For non-agent nodes or new nodes, use the original create/destroy flow
      // If updating, remove old instance first
      if (existingNode) {
        await this.graphCompiler.destroyNode(existingNode);
      }

      // Build input/output node ID sets
      const inputNodeIds = new Set<string>();
      const outputNodeIds = new Set<string>();

      const incomingEdges =
        revision.newSchema.edges?.filter((e) => e.to === nodeSchema.id) || [];
      const outgoingEdges =
        revision.newSchema.edges?.filter((e) => e.from === nodeSchema.id) || [];

      for (const edge of incomingEdges) {
        if (compiledGraph.nodes.has(edge.from)) {
          inputNodeIds.add(edge.from);
        }
      }

      for (const edge of outgoingEdges) {
        if (compiledGraph.nodes.has(edge.to)) {
          outputNodeIds.add(edge.to);
        }
      }

      if (!existingNode) {
        compiledGraph.state.registerNode(nodeSchema.id);
      }

      const instance = await template.create(
        validatedConfig,
        inputNodeIds,
        outputNodeIds,
        {
          ...metadata,
          nodeId: nodeSchema.id,
        },
      );

      const compiledNode: CompiledGraphNode = {
        id: nodeSchema.id,
        type: template.kind,
        template: nodeSchema.template,
        instance,
        config: validatedConfig,
      };

      compiledGraph.nodes.set(nodeSchema.id, compiledNode);
      compiledGraph.state.attachGraphNode(nodeSchema.id, compiledNode);
    }

    this.logger.log(`Live revision applied successfully to graph ${graph.id}`);
  }

  /**
   * Get all revisions for a graph
   */
  async getRevisions(
    graphId: string,
    query: GraphRevisionQueryDto,
  ): Promise<GraphRevisionDto[]> {
    const searchTerms: GraphRevisionSearchTerms = {
      graphId,
      createdBy: this.authContext.checkSub(),
    };

    if (query.status) {
      searchTerms.status = query.status;
    }

    const params: GraphRevisionSearchTerms & AdditionalParams = {
      ...searchTerms,
      orderBy: 'createdAt',
      sortOrder: 'DESC',
    };

    if (typeof query.limit === 'number') {
      params.limit = query.limit;
    }

    const revisions = await this.graphRevisionDao.getAll(params);

    return revisions.map(this.prepareResponse.bind(this));
  }

  /**
   * Get a specific revision by ID for a graph
   */
  async getRevisionById(
    graphId: string,
    revisionId: string,
  ): Promise<GraphRevisionDto> {
    const revision = await this.graphRevisionDao.getOne({
      id: revisionId,
      graphId,
      createdBy: this.authContext.checkSub(),
    });

    if (!revision) {
      throw new NotFoundException('GRAPH_REVISION_NOT_FOUND');
    }

    return this.prepareResponse(revision);
  }

  public prepareResponse(entity: GraphRevisionEntity): GraphRevisionDto {
    return {
      ...entity,
      error: entity.error ?? undefined,
      configurationDiff:
        entity.configurationDiff as GraphRevisionDto['configurationDiff'],
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  private normalizeVersion(version: string): string {
    const coerced = coerce(version);
    return coerced?.version ?? version;
  }

  public generateNextVersion(currentVersion: string): string {
    const normalized = this.normalizeVersion(currentVersion);
    const next = inc(normalized, 'patch');

    if (next) {
      return next;
    }

    const parts = normalized
      .split('.')
      .map((part) => (Number.isNaN(Number(part)) ? 0 : parseInt(part, 10)));

    const lastIndex = Math.max(parts.length - 1, 0);
    parts[lastIndex] = (parts[lastIndex] ?? 0) + 1;
    return parts.join('.');
  }
}
