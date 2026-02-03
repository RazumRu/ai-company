import { Injectable } from '@nestjs/common';
import {
  BadRequestException,
  DefaultLogger,
  NotFoundException,
} from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { AdditionalParams, TypeormService } from '@packages/typeorm';
import { UnrecoverableError } from 'bullmq';
import { compare, type Operation } from 'fast-json-patch';
import { isEqual } from 'lodash';
import { coerce, compare as compareSemver, inc } from 'semver';
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
import {
  type GraphRevisionConfig,
  GraphRevisionEntity,
} from '../entity/graph-revision.entity';
import {
  CompiledGraph,
  CompiledGraphNode,
  GraphEdgeSchemaType,
  GraphNode,
  GraphNodeSchemaType,
  GraphRevisionStatus,
  GraphSchemaType,
  GraphStatus,
  NodeKind,
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
    private readonly logger: DefaultLogger,
    private readonly typeorm: TypeormService,
    private readonly graphDao: GraphDao,
    private readonly graphRevisionDao: GraphRevisionDao,
    private readonly notificationsService: NotificationsService,
    private readonly graphCompiler: GraphCompiler,
    private readonly graphMergeService: GraphMergeService,
    private readonly graphRegistry: GraphRegistry,
    private readonly graphRevisionQueue: GraphRevisionQueueService,
    private readonly templateRegistry: TemplateRegistry,
  ) {
    this.graphRevisionQueue.setProcessor(this.applyRevision.bind(this));
  }

  async queueRevision(
    ctx: AuthContextStorage,
    graph: GraphEntity,
    baseVersion: string,
    clientConfig: GraphRevisionConfig,
    entityManager?: EntityManager,
    options?: { enqueueImmediately?: boolean },
  ): Promise<GraphRevisionDto> {
    const userId = ctx.checkSub();

    const revision = await this.typeorm.trx(async (em: EntityManager) => {
      const { headVersion, headSchema } = await this.resolveHeadSchema(
        graph,
        em,
      );
      const baseSchema = await this.resolveBaseSchema(graph, baseVersion, em);

      const { headConfig, baseConfig } = await this.resolveConfigs(
        graph,
        baseVersion,
        headVersion,
        em,
      );

      // Schema is always part of config; validate the incoming schema
      this.graphCompiler.validateSchema(clientConfig.schema);

      const mergedSchema = this.mergeAndValidateSchemas(
        baseSchema,
        headSchema,
        clientConfig.schema,
        baseVersion,
        headVersion,
      );

      this.graphCompiler.validateSchema(mergedSchema);

      const mergedConfig: GraphRevisionConfig = {
        ...this.mergeGraphFields(
          baseConfig,
          headConfig,
          clientConfig,
          baseVersion,
          headVersion,
        ),
        schema: mergedSchema,
      };

      const configDiff = compare(headConfig, mergedConfig);

      if (configDiff.length === 0) {
        throw new BadRequestException(
          'REVISION_WITHOUT_CHANGES',
          'Submitted update has no changes compared to current graph version',
          { baseVersion, headVersion },
        );
      }

      const newVersion = this.generateNextVersion(headVersion);

      const revision = await this.graphRevisionDao.create(
        {
          graphId: graph.id,
          baseVersion,
          toVersion: newVersion,
          configDiff,
          clientConfig,
          newConfig: mergedConfig,
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

    return { headVersion, headSchema: headRevision.newConfig.schema };
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

    return baseRevision.newConfig.schema;
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

  private getConfigFromGraph(graph: GraphEntity): GraphRevisionConfig {
    return {
      schema: graph.schema,
      name: graph.name,
      description: graph.description ?? null,
      temporary: graph.temporary,
    };
  }

  private getConfigFromRevision(
    revision: GraphRevisionEntity,
  ): GraphRevisionConfig {
    return revision.newConfig;
  }

  private async resolveConfigs(
    graph: GraphEntity,
    baseVersion: string,
    headVersion: string,
    entityManager: EntityManager,
  ): Promise<{
    headConfig: GraphRevisionConfig;
    baseConfig: GraphRevisionConfig;
  }> {
    let headConfig = this.getConfigFromGraph(graph);
    if (headVersion !== graph.version) {
      const headRevision = await this.getSchemaAtVersion(
        graph.id,
        headVersion,
        entityManager,
      );
      if (headRevision) {
        headConfig = this.getConfigFromRevision(headRevision);
      }
    }

    if (baseVersion === graph.version) {
      return { headConfig, baseConfig: this.getConfigFromGraph(graph) };
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

    return { headConfig, baseConfig: this.getConfigFromRevision(baseRevision) };
  }

  private mergeGraphFields(
    base: GraphRevisionConfig,
    head: GraphRevisionConfig,
    client: GraphRevisionConfig,
    baseVersion: string,
    headVersion: string,
  ): Omit<GraphRevisionConfig, 'schema'> {
    const merged: Omit<GraphRevisionConfig, 'schema'> = {
      name: head.name,
      description: head.description,
      temporary: head.temporary,
    };

    const conflicts: {
      field: keyof Omit<GraphRevisionConfig, 'schema'>;
      base: unknown;
      head: unknown;
      client: unknown;
    }[] = [];

    const fields: (keyof Omit<GraphRevisionConfig, 'schema'>)[] = [
      'name',
      'description',
      'temporary',
    ];

    for (const field of fields) {
      const baseVal = base[field];
      const headVal = head[field];
      const clientVal = client[field];

      if (isEqual(headVal, baseVal)) {
        merged[field] = clientVal as never;
        continue;
      }

      if (isEqual(clientVal, baseVal)) {
        merged[field] = headVal as never;
        continue;
      }

      if (isEqual(clientVal, headVal)) {
        merged[field] = headVal as never;
        continue;
      }

      conflicts.push({
        field,
        base: baseVal,
        head: headVal,
        client: clientVal,
      });
    }

    if (conflicts.length > 0) {
      throw new BadRequestException(
        'MERGE_CONFLICT',
        'Cannot merge graph updates due to conflicts',
        { conflicts, headVersion, baseVersion },
      );
    }

    return merged;
  }

  /**
   * Re-merges revision's client changes against current graph head if needed.
   * Updates revision entity in-place with the re-merged schema and diff.
   */
  private async reMergeRevisionIfNeeded(
    revision: GraphRevisionEntity,
    graph: GraphEntity,
    baseSchemaCache: GraphSchemaType | null,
    baseConfigCache: GraphRevisionConfig | null,
    entityManager: EntityManager,
  ): Promise<void> {
    const currentHead = graph.schema;
    const headHasChanged = graph.version !== revision.baseVersion;
    const currentHeadConfig = this.getConfigFromGraph(graph);

    // No re-merge needed if head hasn't changed since the revision was queued
    if (!headHasChanged) {
      const next = revision.newConfig;
      this.graphCompiler.validateSchema(next.schema);
      await this.updateRevisionConfig(
        revision,
        next,
        currentHeadConfig,
        entityManager,
      );

      return;
    }

    // Re-merge client changes against new head
    const nextBaseConfig = baseConfigCache;
    const baseSchema = baseSchemaCache ?? nextBaseConfig?.schema ?? null;

    if (!nextBaseConfig || !baseSchema) {
      // Can't reliably re-merge; just refresh diff against current head
      await this.updateRevisionConfig(
        revision,
        revision.newConfig,
        currentHeadConfig,
        entityManager,
      );
      return;
    }

    const reMergedSchema = this.mergeAndValidateSchemas(
      baseSchema,
      currentHead,
      revision.clientConfig.schema,
      revision.baseVersion,
      graph.version,
    );

    const reMergedFields = this.mergeGraphFields(
      nextBaseConfig,
      currentHeadConfig,
      revision.clientConfig,
      revision.baseVersion,
      graph.version,
    );

    const reMergedConfig: GraphRevisionConfig = {
      ...reMergedFields,
      schema: reMergedSchema,
    };

    this.graphCompiler.validateSchema(reMergedConfig.schema);
    await this.updateRevisionConfig(
      revision,
      reMergedConfig,
      currentHeadConfig,
      entityManager,
    );
  }

  private async updateRevisionConfig(
    revision: GraphRevisionEntity,
    newConfig: GraphRevisionConfig,
    currentHeadConfig: GraphRevisionConfig,
    entityManager: EntityManager,
  ): Promise<void> {
    const diff = compare(currentHeadConfig, newConfig);
    const updated = await this.graphRevisionDao.updateById(
      revision.id,
      { newConfig, configDiff: diff },
      {},
      entityManager,
    );

    if (updated) {
      revision.newConfig = updated.newConfig;
      revision.configDiff = updated.configDiff as Operation[];
    } else {
      revision.newConfig = newConfig;
      revision.configDiff = diff;
    }
  }

  private async finalizeAppliedRevision(
    graph: GraphEntity,
    revision: GraphRevisionEntity,
    entityManager: EntityManager,
  ): Promise<void> {
    // Invariant repair: ensure targetVersion never falls behind version.
    // If targetVersion is corrupted (or legacy), bump it up to at least the applied version.
    const targetVersion = this.isVersionLess(
      graph.targetVersion,
      revision.toVersion,
    )
      ? revision.toVersion
      : graph.targetVersion;

    const graphUpdates: Partial<GraphEntity> = {
      schema: revision.newConfig.schema,
      name: revision.newConfig.name,
      description: revision.newConfig.description ?? undefined,
      temporary: revision.newConfig.temporary,
      version: revision.toVersion,
      targetVersion,
    };

    await this.graphDao.updateById(
      revision.graphId,
      graphUpdates,
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

    // If revision is already "Applying", this is a retry after server crash/disconnect.
    // BullMQ automatically retries jobs that weren't acknowledged.
    // We just continue with the work - the transaction will be idempotent or handle the state.
    if (revision.status === GraphRevisionStatus.Pending) {
      // Mark as "Applying" OUTSIDE the transaction so observers can see it in real-time
      await this.graphRevisionDao.updateById(revision.id, {
        status: GraphRevisionStatus.Applying,
      });

      await this.notificationsService.emit({
        type: NotificationEvent.GraphRevisionApplying,
        graphId: revision.graphId,
        data: { ...revision, status: GraphRevisionStatus.Applying },
      });
    }

    const baseSchemaCache = await this.fetchBaseSchemaCache(revision);
    const baseConfigCache = await this.fetchBaseConfigCache(revision);

    try {
      await this.applyRevisionTransaction(
        revision,
        baseSchemaCache,
        baseConfigCache,
      );
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
    return baseRevision?.newConfig.schema ?? null;
  }

  private async fetchBaseConfigCache(
    revision: GraphRevisionEntity,
  ): Promise<GraphRevisionConfig | null> {
    const baseRevision = await this.getSchemaAtVersion(
      revision.graphId,
      revision.baseVersion,
    );
    return baseRevision?.newConfig ?? null;
  }

  private async applyRevisionTransaction(
    revision: GraphRevisionEntity,
    baseSchemaCache: GraphSchemaType | null,
    baseConfigCache: GraphRevisionConfig | null,
  ): Promise<void> {
    await this.typeorm.trx(async (entityManager) => {
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
        baseConfigCache,
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
    const name = revision.newConfig.name;
    const temporary = revision.newConfig.temporary;

    const metadata = {
      graphId: graph.id,
      name,
      version: revision.toVersion,
      temporary,
      graph_created_by: graph.createdBy,
    };

    const oldNodeIds = new Set(compiledGraph.nodes.keys());
    const newNodeIds = new Set(
      revision.newConfig.schema.nodes.map((n: GraphNodeSchemaType) => n.id),
    );

    // Remove deleted nodes
    await this.removeDeletedNodes(compiledGraph, oldNodeIds, newNodeIds);

    // Update edges in compiled graph
    const oldEdges = compiledGraph.edges;
    const newEdges = revision.newConfig.schema.edges || [];
    compiledGraph.edges = newEdges;

    // Calculate which nodes need rebuilding
    const nodesToRebuild = this.calculateNodesToRebuild(
      revision.newConfig.schema.nodes,
      compiledGraph,
      oldEdges,
      newEdges,
    );

    // Expand to include dependent nodes
    this.expandToIncludeDependents(nodesToRebuild, newEdges);

    // Rebuild nodes in topological order
    const buildOrder = this.graphCompiler.getBuildOrder(
      revision.newConfig.schema,
    );
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
      graph_created_by: string;
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

    // Runtime nodes manage external resources (containers, networks, etc). For these,
    // live revisions should rebuild from scratch instead of in-place reconfigure.
    if (existingNode.type === NodeKind.Runtime) {
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
      configDiff: entity.configDiff as GraphRevisionDto['configDiff'],
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  private normalizeVersion(version: string): string {
    const coerced = coerce(version);
    return coerced?.version ?? version;
  }

  private isVersionLess(a: string, b: string): boolean {
    const av = coerce(a)?.version;
    const bv = coerce(b)?.version;
    if (!av || !bv) {
      return false;
    }
    return compareSemver(av, bv) === -1;
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
    ctx: AuthContextStorage,
    graphId: string,
    query: GraphRevisionQueryDto,
  ): Promise<GraphRevisionDto[]> {
    const userId = ctx.checkSub();
    const searchTerms: SearchTerms = {
      graphId,
      createdBy: userId,
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
    ctx: AuthContextStorage,
    graphId: string,
    revisionId: string,
  ): Promise<GraphRevisionDto> {
    const userId = ctx.checkSub();
    const revision = await this.graphRevisionDao.getOne({
      id: revisionId,
      graphId,
      createdBy: userId,
    });

    if (!revision) {
      throw new NotFoundException('GRAPH_REVISION_NOT_FOUND');
    }

    return this.prepareResponse(revision);
  }
}
