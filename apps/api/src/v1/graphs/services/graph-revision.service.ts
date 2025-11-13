import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  DefaultLogger,
  NotFoundException,
} from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { AdditionalParams, TypeormService } from '@packages/typeorm';
import { UnrecoverableError } from 'bullmq';
import { compare, type Operation } from 'fast-json-patch';
import { coerce, inc } from 'semver';
import { EntityManager } from 'typeorm';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { GraphDao } from '../dao/graph.dao';
import { GraphRevisionDao, SearchTerms } from '../dao/graph-revision.dao';
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
} from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphMergeService } from './graph-merge.service';
import { GraphRegistry } from './graph-registry';
import {
  GraphRevisionJobData,
  GraphRevisionQueueService,
} from './graph-revision-queue.service';

@Injectable()
export class GraphRevisionService {
  constructor(
    private readonly graphRevisionDao: GraphRevisionDao,
    private readonly graphDao: GraphDao,
    private readonly graphRevisionQueue: GraphRevisionQueueService,
    private readonly graphRegistry: GraphRegistry,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphMergeService: GraphMergeService,
    private readonly typeorm: TypeormService,
    private readonly notificationsService: NotificationsService,
    private readonly authContext: AuthContextService,
    private readonly logger: DefaultLogger,
    private readonly templateRegistry: TemplateRegistry,
  ) {
    this.graphRevisionQueue.setProcessor(this.applyRevision.bind(this));
  }

  async queueRevision(
    graph: GraphEntity,
    baseVersion: string,
    clientSchema: GraphSchemaType,
    entityManager?: EntityManager,
  ): Promise<GraphRevisionDto> {
    const userId = this.authContext.checkSub();

    return this.typeorm.trx(async (em: EntityManager) => {
      this.graphCompiler.validateSchema(clientSchema);

      const { headVersion, headSchema } = await this.resolveHeadSchema(
        graph,
        em,
      );
      const baseSchema = await this.resolveBaseSchema(graph, baseVersion, em);

      const mergeResult = this.graphMergeService.mergeSchemas(
        baseSchema,
        headSchema,
        clientSchema,
      );

      if (!mergeResult.success) {
        throw new BadRequestException(
          'MERGE_CONFLICT',
          'Cannot merge changes due to conflicts',
          {
            conflicts: mergeResult.conflicts,
            headVersion,
          },
        );
      }

      const mergedSchema = mergeResult.mergedSchema!;
      const configurationDiff = compare(headSchema, mergedSchema);
      const newVersion = this.generateNextVersion(headVersion);

      const revision = await this.graphRevisionDao.create(
        {
          graphId: graph.id,
          baseVersion,
          toVersion: newVersion,
          configurationDiff,
          clientSchema,
          newSchema: mergedSchema,
          status: GraphRevisionStatus.Pending,
          createdBy: userId,
        },
        em,
      );

      await this.graphDao.updateById(
        graph.id,
        { targetVersion: newVersion },
        em,
      );

      await this.notificationsService.emit({
        type: NotificationEvent.GraphRevisionCreate,
        graphId: graph.id,
        data: revision,
      });

      await this.graphRevisionQueue.addRevision(revision);

      return this.prepareResponse(revision);
    }, entityManager);
  }

  private async resolveHeadSchema(
    graph: GraphEntity,
    entityManager: EntityManager,
  ): Promise<{ headVersion: string; headSchema: GraphSchemaType }> {
    const headVersion = graph.targetVersion;

    if (headVersion === graph.version) {
      return { headVersion, headSchema: graph.schema };
    }

    const headRevision = await this.getSchemaAtVersion(
      graph.id,
      headVersion,
      entityManager,
    );

    if (!headRevision) {
      this.logger.warn(
        `Could not find revision at targetVersion ${headVersion}, using current schema`,
      );
      return { headVersion, headSchema: graph.schema };
    }

    return { headVersion, headSchema: headRevision.newSchema };
  }

  private async resolveBaseSchema(
    graph: GraphEntity,
    baseVersion: string,
    entityManager: EntityManager,
  ): Promise<GraphSchemaType> {
    if (baseVersion === graph.version) {
      return graph.schema;
    }

    const baseRevision = await this.getSchemaAtVersion(
      graph.id,
      baseVersion,
      entityManager,
    );

    if (!baseRevision) {
      throw new BadRequestException(
        'VERSION_NOT_FOUND',
        `Base version ${baseVersion} not found. Please refresh and retry.`,
      );
    }

    return baseRevision.newSchema;
  }

  private async getSchemaAtVersion(
    graphId: string,
    version: string,
    entityManager?: EntityManager,
  ): Promise<GraphRevisionEntity | null> {
    const revision = await this.graphRevisionDao.getOne(
      {
        graphId,
        toVersion: version,
      },
      entityManager,
    );

    return revision || null;
  }

  private async ensureRevisionSchemaUpToDate(
    revision: GraphRevisionEntity,
    graph: GraphEntity,
    baseSchemaCache: GraphSchemaType | null,
    entityManager: EntityManager,
  ): Promise<void> {
    const currentHead = graph.schema;
    const headChangedSinceQueue = graph.version !== revision.baseVersion;

    if (!headChangedSinceQueue) {
      this.graphCompiler.validateSchema(revision.newSchema);
      await this.syncRevisionSchema(
        revision,
        revision.newSchema,
        currentHead,
        entityManager,
      );
      return;
    }

    if (!baseSchemaCache) {
      this.logger.warn(
        `[APPLY-REMERGE-SKIP] Base schema not found for initial version ${revision.baseVersion}. Using cached merge.`,
      );
      this.graphCompiler.validateSchema(revision.newSchema);
      await this.syncRevisionSchema(
        revision,
        revision.newSchema,
        currentHead,
        entityManager,
      );
      return;
    }

    const reMergeResult = this.graphMergeService.mergeSchemas(
      baseSchemaCache,
      currentHead,
      revision.clientSchema,
    );

    if (!reMergeResult.success) {
      throw new BadRequestException(
        'MERGE_CONFLICT_ON_APPLY',
        'Cannot apply revision: client changes conflict with current head',
        {
          conflicts: reMergeResult.conflicts,
          currentVersion: graph.version,
        },
      );
    }

    const reMergedSchema = reMergeResult.mergedSchema!;
    this.graphCompiler.validateSchema(reMergedSchema);

    await this.syncRevisionSchema(
      revision,
      reMergedSchema,
      currentHead,
      entityManager,
    );
  }

  private async syncRevisionSchema(
    revision: GraphRevisionEntity,
    schemaToPersist: GraphSchemaType,
    headSchema: GraphSchemaType,
    entityManager: EntityManager,
  ): Promise<void> {
    const diff = compare(headSchema, schemaToPersist);

    const updated = await this.graphRevisionDao.updateById(
      revision.id,
      {
        newSchema: schemaToPersist,
        configurationDiff: diff,
      },
      {},
      entityManager,
    );

    revision.newSchema = updated?.newSchema ?? schemaToPersist;
    revision.configurationDiff =
      (updated?.configurationDiff as Operation[]) ?? diff;
  }

  private async finalizeAppliedRevision(
    graph: GraphEntity,
    revision: GraphRevisionEntity,
    entityManager: EntityManager,
  ): Promise<void> {
    await this.graphDao.updateById(
      revision.graphId,
      {
        schema: revision.newSchema,
        version: revision.toVersion,
      },
      entityManager,
    );

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
  }

  private async applyRevision(job: GraphRevisionJobData): Promise<void> {
    const revision = await this.graphRevisionDao.getById(job.revisionId);
    if (!revision) {
      throw new NotFoundException('GRAPH_REVISION_NOT_FOUND');
    }

    let baseSchemaCache: GraphSchemaType | null = null;
    const baseRevision = await this.getSchemaAtVersion(
      revision.graphId,
      revision.baseVersion,
    );
    if (baseRevision) {
      baseSchemaCache = baseRevision.newSchema;
    }

    try {
      await this.typeorm.trx(async (entityManager) => {
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

        await this.ensureRevisionSchemaUpToDate(
          revision,
          graph,
          baseSchemaCache,
          entityManager,
        );

        const compiledGraph = this.graphRegistry.get(revision.graphId);
        const isRunning =
          !!compiledGraph && graph.status === GraphStatus.Running;

        if (!isRunning || !compiledGraph) {
          this.logger.warn(
            `Graph ${revision.graphId} is not running. Applying revision only to persisted schema.`,
          );
          await this.finalizeAppliedRevision(graph, revision, entityManager);
          return;
        }

        await this.applyLiveUpdate(graph, revision, compiledGraph);
        await this.finalizeAppliedRevision(graph, revision, entityManager);
      });
    } catch (error) {
      this.logger.error(
        error as Error,
        `Failed to apply graph revision ${revision.id}`,
      );

      // Reset targetVersion to current version when revision fails
      // This ensures subsequent revisions don't merge against the failed revision's schema
      await this.typeorm.trx(async (entityManager) => {
        const graph = await this.graphDao.getOne(
          { id: revision.graphId },
          entityManager,
        );

        if (graph && graph.targetVersion === revision.toVersion) {
          await this.graphDao.updateById(
            graph.id,
            { targetVersion: graph.version },
            entityManager,
          );
        }

        await this.graphRevisionDao.updateById(
          revision.id,
          {
            status: GraphRevisionStatus.Failed,
            error: (error as Error).message,
          },
          {},
          entityManager,
        );
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

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw new UnrecoverableError(
          `Graph revision ${revision.id} failed with unrecoverable error: ${(error as Error).message}`,
        );
      }

      throw error;
    }
  }

  private async applyLiveUpdate(
    graph: GraphEntity,
    revision: GraphRevisionEntity,
    compiledGraph: ReturnType<typeof this.graphRegistry.get>,
  ): Promise<void> {
    if (!compiledGraph) return;

    const metadata = {
      graphId: graph.id,
      name: graph.name,
      version: revision.toVersion,
      temporary: graph.temporary,
    };

    const oldNodeIds = new Set(compiledGraph.nodes.keys());
    const newNodeIds = new Set(
      revision.newSchema.nodes.map((n: { id: string }) => n.id),
    );

    const oldEdges = compiledGraph.edges || [];

    for (const nodeId of oldNodeIds) {
      if (!newNodeIds.has(nodeId)) {
        const node = compiledGraph.nodes.get(nodeId);
        if (node) {
          await this.graphCompiler.destroyNode(node);
        }
        compiledGraph.nodes.delete(nodeId);
        compiledGraph.state.unregisterNode(nodeId);
      }
    }

    compiledGraph.edges = revision.newSchema.edges || [];

    const buildOrder = this.graphCompiler.getBuildOrder(revision.newSchema);

    for (const nodeSchema of buildOrder) {
      const existingNode = compiledGraph.nodes.get(
        nodeSchema.id,
      ) as CompiledGraphNode<SimpleAgent>;

      const oldIncomingEdges = oldEdges.filter((e) => e.to === nodeSchema.id);
      const oldOutgoingEdges = oldEdges.filter((e) => e.from === nodeSchema.id);
      const newIncomingEdges =
        revision.newSchema.edges?.filter((e) => e.to === nodeSchema.id) || [];
      const newOutgoingEdges =
        revision.newSchema.edges?.filter((e) => e.from === nodeSchema.id) || [];

      const edgesChanged =
        JSON.stringify(oldIncomingEdges) !== JSON.stringify(newIncomingEdges) ||
        JSON.stringify(oldOutgoingEdges) !== JSON.stringify(newOutgoingEdges);

      if (
        existingNode &&
        JSON.stringify(existingNode.config) ===
          JSON.stringify(nodeSchema.config) &&
        !edgesChanged
      ) {
        continue;
      }

      const template = this.templateRegistry.getTemplate(nodeSchema.template);
      if (!template) {
        throw new BadRequestException(
          'GRAPH_TEMPLATE_NOT_FOUND',
          `Template '${nodeSchema.template}' not found`,
        );
      }

      const validatedConfig = this.templateRegistry.validateTemplateConfig(
        nodeSchema.template,
        nodeSchema.config,
      );

      if (existingNode) {
        await this.graphCompiler.destroyNode(existingNode);
      }

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

  /**
   * Get all revisions for a graph
   */
  async getRevisions(
    graphId: string,
    query: GraphRevisionQueryDto,
  ): Promise<GraphRevisionDto[]> {
    const searchTerms: SearchTerms = {
      graphId,
      createdBy: this.authContext.checkSub(),
    };

    if (query.status) {
      searchTerms.status = query.status;
    }

    const params: SearchTerms & AdditionalParams = {
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
}
