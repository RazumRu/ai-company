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
import { isEqual } from 'lodash';
import { coerce, inc } from 'semver';
import { setTimeout } from 'timers/promises';
import { EntityManager } from 'typeorm';

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
  CompiledGraph,
  CompiledGraphNode,
  GraphEdgeSchemaType,
  GraphNode,
  GraphNodeSchemaType,
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
    options?: { enqueueImmediately?: boolean },
  ): Promise<GraphRevisionDto> {
    const userId = this.authContext.checkSub();

    const revision = await this.typeorm.trx(async (em: EntityManager) => {
      this.graphCompiler.validateSchema(clientSchema);

      const { headVersion, headSchema } = await this.resolveHeadSchema(
        graph,
        em,
      );
      const baseSchema = await this.resolveBaseSchema(graph, baseVersion, em);

      const mergedSchema = this.mergeAndValidateSchemas(
        baseSchema,
        headSchema,
        clientSchema,
        baseVersion,
        headVersion,
      );

      const configurationDiff = compare(headSchema, mergedSchema);
      if (configurationDiff.length === 0) {
        throw new BadRequestException(
          'REVISION_WITHOUT_CHANGES',
          'Submitted schema has no changes compared to current graph version',
          { baseVersion, headVersion },
        );
      }

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

      return revision;
    }, entityManager);

    const response = this.prepareResponse(revision);

    const shouldEnqueue = options?.enqueueImmediately ?? true;
    if (shouldEnqueue) {
      await this.graphRevisionQueue.addRevision({
        id: revision.id,
        graphId: revision.graphId,
      });
    }

    return response;
  }

  async enqueueRevisionProcessing(
    revision: Pick<GraphRevisionDto, 'id' | 'graphId'>,
  ): Promise<void> {
    await this.graphRevisionQueue.addRevision(revision);
  }

  private mergeAndValidateSchemas(
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
    baseVersion: string,
    headVersion: string,
  ): GraphSchemaType {
    const mergeResult = this.graphMergeService.mergeSchemas(
      baseSchema,
      headSchema,
      clientSchema,
    );

    if (!mergeResult.success) {
      throw new BadRequestException(
        'MERGE_CONFLICT',
        'Cannot merge changes due to conflicts',
        { conflicts: mergeResult.conflicts, headVersion },
      );
    }

    if (!mergeResult.mergedSchema) {
      throw new BadRequestException(
        'MERGE_FAILED',
        'Merge succeeded but produced no schema',
        { baseVersion, headVersion },
      );
    }

    return mergeResult.mergedSchema;
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
        `Could not find revision at targetVersion ${headVersion}, falling back to current schema`,
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

  /**
   * Re-merges revision's client changes against current graph head if needed.
   * Updates revision entity in-place with the re-merged schema and diff.
   */
  private async reMergeRevisionIfNeeded(
    revision: GraphRevisionEntity,
    graph: GraphEntity,
    baseSchemaCache: GraphSchemaType | null,
    entityManager: EntityManager,
  ): Promise<void> {
    const currentHead = graph.schema;
    const headHasChanged = graph.version !== revision.baseVersion;

    // No re-merge needed if head hasn't changed since the revision was queued
    if (!headHasChanged || !baseSchemaCache) {
      this.graphCompiler.validateSchema(revision.newSchema);
      await this.updateRevisionSchema(
        revision,
        revision.newSchema,
        currentHead,
        entityManager,
      );
      return;
    }

    // Re-merge client changes against new head
    const reMergedSchema = this.mergeAndValidateSchemas(
      baseSchemaCache,
      currentHead,
      revision.clientSchema,
      revision.baseVersion,
      graph.version,
    );

    this.graphCompiler.validateSchema(reMergedSchema);

    await this.updateRevisionSchema(
      revision,
      reMergedSchema,
      currentHead,
      entityManager,
    );
  }

  private async updateRevisionSchema(
    revision: GraphRevisionEntity,
    newSchema: GraphSchemaType,
    currentHeadSchema: GraphSchemaType,
    entityManager: EntityManager,
  ): Promise<void> {
    const diff = compare(currentHeadSchema, newSchema);

    const updated = await this.graphRevisionDao.updateById(
      revision.id,
      { newSchema, configurationDiff: diff },
      {},
      entityManager,
    );

    if (updated) {
      revision.newSchema = updated.newSchema;
      revision.configurationDiff = updated.configurationDiff as Operation[];
    } else {
      revision.newSchema = newSchema;
      revision.configurationDiff = diff;
    }
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

    const baseSchemaCache = await this.fetchBaseSchemaCache(revision);

    try {
      await this.markRevisionAsApplying(revision);
      await this.applyRevisionTransaction(revision, baseSchemaCache);
    } catch (error) {
      await this.handleRevisionFailure(revision, error as Error);
      this.rethrowIfUnrecoverable(error as Error, revision.id);
      throw error;
    }
  }

  private async fetchBaseSchemaCache(
    revision: GraphRevisionEntity,
  ): Promise<GraphSchemaType | null> {
    const baseRevision = await this.getSchemaAtVersion(
      revision.graphId,
      revision.baseVersion,
    );
    return baseRevision?.newSchema ?? null;
  }

  private async markRevisionAsApplying(
    revision: GraphRevisionEntity,
  ): Promise<void> {
    await this.graphRevisionDao.updateById(revision.id, {
      status: GraphRevisionStatus.Applying,
    });
  }

  private async applyRevisionTransaction(
    revision: GraphRevisionEntity,
    baseSchemaCache: GraphSchemaType | null,
  ): Promise<void> {
    await this.typeorm.trx(async (entityManager) => {
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

      await this.reMergeRevisionIfNeeded(
        revision,
        graph,
        baseSchemaCache,
        entityManager,
      );

      const compiledGraph = this.graphRegistry.get(revision.graphId);
      await this.waitForGraphCompilationIfNeeded(compiledGraph);

      const shouldApplyLive = compiledGraph?.status === GraphStatus.Running;

      if (shouldApplyLive) {
        await this.applyLiveUpdate(graph, revision, compiledGraph);
      }

      await this.finalizeAppliedRevision(graph, revision, entityManager);
    });
  }

  private async waitForGraphCompilationIfNeeded(
    compiledGraph: CompiledGraph | null | undefined,
  ): Promise<void> {
    if (!compiledGraph || compiledGraph.status !== GraphStatus.Compiling) {
      return;
    }

    const startTime = Date.now();

    while (Date.now() - startTime < 180_000) {
      if (compiledGraph.status !== GraphStatus.Compiling) {
        return;
      }
      await setTimeout(5_000);
    }

    // Graph is still compiling after timeout - proceed anyway
    this.logger.warn(
      `Graph compilation timeout after 3min, proceeding with revision application`,
    );
  }

  private async handleRevisionFailure(
    revision: GraphRevisionEntity,
    error: Error,
  ): Promise<void> {
    this.logger.error(error, `Failed to apply graph revision ${revision.id}`);

    await this.typeorm.trx(async (entityManager) => {
      await this.resetTargetVersionIfNeeded(revision, entityManager);
      await this.markRevisionAsFailed(revision, error, entityManager);
    });

    await this.notificationsService.emit({
      type: NotificationEvent.GraphRevisionFailed,
      graphId: revision.graphId,
      data: {
        ...revision,
        status: GraphRevisionStatus.Failed,
        error: error.message,
      },
    });
  }

  private async resetTargetVersionIfNeeded(
    revision: GraphRevisionEntity,
    entityManager: EntityManager,
  ): Promise<void> {
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
  }

  private async markRevisionAsFailed(
    revision: GraphRevisionEntity,
    error: Error,
    entityManager: EntityManager,
  ): Promise<void> {
    await this.graphRevisionDao.updateById(
      revision.id,
      { status: GraphRevisionStatus.Failed, error: error.message },
      {},
      entityManager,
    );
  }

  private rethrowIfUnrecoverable(error: Error, revisionId: string): void {
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw new UnrecoverableError(
        `Graph revision ${revisionId} failed with unrecoverable error: ${error.message}`,
      );
    }
  }

  private async applyLiveUpdate(
    graph: GraphEntity,
    revision: GraphRevisionEntity,
    compiledGraph: CompiledGraph,
  ): Promise<void> {
    const metadata = {
      graphId: graph.id,
      name: graph.name,
      version: revision.toVersion,
      temporary: graph.temporary,
    };

    const oldNodeIds = new Set(compiledGraph.nodes.keys());
    const newNodeIds = new Set(
      revision.newSchema.nodes.map((n: GraphNodeSchemaType) => n.id),
    );

    // Remove deleted nodes
    await this.removeDeletedNodes(compiledGraph, oldNodeIds, newNodeIds);

    // Update edges in compiled graph
    const oldEdges = compiledGraph.edges;
    const newEdges = revision.newSchema.edges || [];
    compiledGraph.edges = newEdges;

    // Calculate which nodes need rebuilding
    const nodesToRebuild = this.calculateNodesToRebuild(
      revision.newSchema.nodes,
      compiledGraph,
      oldEdges,
      newEdges,
    );

    // Expand to include dependent nodes
    this.expandToIncludeDependents(nodesToRebuild, newEdges);

    // Rebuild nodes in topological order
    const buildOrder = this.graphCompiler.getBuildOrder(revision.newSchema);
    await this.rebuildNodes(
      buildOrder,
      compiledGraph,
      nodesToRebuild,
      metadata,
      newEdges,
    );
  }

  private async removeDeletedNodes(
    compiledGraph: CompiledGraph,
    oldNodeIds: Set<string>,
    newNodeIds: Set<string>,
  ): Promise<void> {
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
  }

  private calculateNodesToRebuild(
    newNodeSchemas: GraphNodeSchemaType[],
    compiledGraph: CompiledGraph,
    oldEdges: GraphEdgeSchemaType[],
    newEdges: GraphEdgeSchemaType[],
  ): Set<string> {
    const nodesToRebuild = new Set<string>();

    for (const nodeSchema of newNodeSchemas) {
      const existingNode = compiledGraph.nodes.get(nodeSchema.id);

      const configChanged =
        !existingNode || !isEqual(existingNode.config, nodeSchema.config);

      const edgesChanged = this.haveEdgesChanged(
        nodeSchema.id,
        oldEdges,
        newEdges,
      );

      if (configChanged || edgesChanged) {
        nodesToRebuild.add(nodeSchema.id);
      }
    }

    return nodesToRebuild;
  }

  private haveEdgesChanged(
    nodeId: string,
    oldEdges: GraphEdgeSchemaType[],
    newEdges: GraphEdgeSchemaType[],
  ): boolean {
    const oldIncoming = oldEdges.filter((e) => e.to === nodeId);
    const oldOutgoing = oldEdges.filter((e) => e.from === nodeId);
    const newIncoming = newEdges.filter((e) => e.to === nodeId);
    const newOutgoing = newEdges.filter((e) => e.from === nodeId);

    return (
      !isEqual(oldIncoming, newIncoming) || !isEqual(oldOutgoing, newOutgoing)
    );
  }

  private expandToIncludeDependents(
    nodesToRebuild: Set<string>,
    edges: GraphEdgeSchemaType[],
  ): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (nodesToRebuild.has(edge.to) && !nodesToRebuild.has(edge.from)) {
          nodesToRebuild.add(edge.from);
          changed = true;
        }
      }
    }
  }

  private async rebuildNodes(
    buildOrder: GraphNodeSchemaType[],
    compiledGraph: CompiledGraph,
    nodesToRebuild: Set<string>,
    metadata: {
      graphId: string;
      name: string;
      version: string;
      temporary: boolean;
    },
    edges: GraphEdgeSchemaType[],
  ): Promise<void> {
    for (const nodeSchema of buildOrder) {
      if (!nodesToRebuild.has(nodeSchema.id)) {
        continue;
      }

      const existingNode = compiledGraph.nodes.get(nodeSchema.id);

      const { template, validatedConfig, init } =
        this.graphCompiler.prepareNode(
          nodeSchema,
          compiledGraph.nodes,
          metadata,
          edges,
        );

      if (!existingNode) {
        compiledGraph.state.registerNode(nodeSchema.id);
      }

      const reconfigured = await this.tryReconfigureInPlace(
        existingNode,
        nodeSchema,
        init,
        validatedConfig,
        compiledGraph,
      );

      if (reconfigured) {
        continue;
      }

      // Reconfigure failed or node is new - recreate from scratch
      await this.recreateNode(
        existingNode,
        nodeSchema,
        template,
        validatedConfig,
        init,
        compiledGraph,
      );
    }
  }

  private async tryReconfigureInPlace(
    existingNode: CompiledGraphNode | undefined,
    nodeSchema: GraphNodeSchemaType,
    init: GraphNode<unknown>,
    validatedConfig: unknown,
    compiledGraph: CompiledGraph,
  ): Promise<boolean> {
    if (!existingNode || existingNode.template !== nodeSchema.template) {
      return false;
    }

    try {
      await existingNode.handle.configure(init, existingNode.instance);
      existingNode.config = validatedConfig;
      compiledGraph.nodes.set(nodeSchema.id, existingNode);
      compiledGraph.state.attachGraphNode(nodeSchema.id, existingNode);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `In-place reconfigure failed for node ${nodeSchema.id}, will recreate: ${errorMessage}`,
      );
      return false;
    }
  }

  private async recreateNode(
    existingNode: CompiledGraphNode | undefined,
    nodeSchema: GraphNodeSchemaType,
    template: NonNullable<ReturnType<typeof this.templateRegistry.getTemplate>>,
    validatedConfig: unknown,
    init: GraphNode<unknown>,
    compiledGraph: CompiledGraph,
  ): Promise<void> {
    if (existingNode) {
      await this.graphCompiler.destroyNode(existingNode);
    }

    const { handle, instance } =
      await this.graphCompiler.createAndConfigureHandle(
        template,
        validatedConfig,
        init,
      );

    const compiledNode: CompiledGraphNode = {
      id: nodeSchema.id,
      type: template.kind,
      template: nodeSchema.template,
      handle,
      instance,
      config: validatedConfig,
    };

    compiledGraph.nodes.set(nodeSchema.id, compiledNode);
    compiledGraph.state.attachGraphNode(nodeSchema.id, compiledNode);
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

    // Fallback: manual increment if semver fails
    const parts = normalized
      .split('.')
      .map((part) => (Number.isNaN(Number(part)) ? 0 : parseInt(part, 10)));

    const lastIndex = Math.max(parts.length - 1, 0);
    parts[lastIndex] = (parts[lastIndex] ?? 0) + 1;
    return parts.join('.');
  }

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
