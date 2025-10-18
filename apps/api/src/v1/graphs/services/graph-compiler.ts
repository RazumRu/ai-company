import { Injectable } from '@nestjs/common';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { groupBy } from 'lodash';

import { environment } from '../../../environments';
import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
import { GraphEntity } from '../entity/graph.entity';
import {
  CompiledGraph,
  CompiledGraphNode,
  GraphMetadataSchemaType,
  GraphNodeSchemaType,
  GraphSchemaType,
  NodeKind,
} from '../graphs.types';

@Injectable()
export class GraphCompiler {
  constructor(
    private readonly templateRegistry: TemplateRegistry,
    private readonly logger: DefaultLogger,
    private readonly notificationsService: NotificationsService,
  ) {}

  validateSchema(schema: GraphSchemaType): void {
    const ids = schema.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new BadRequestException('GRAPH_DUPLICATE_NODE');
    }

    if (schema.edges) {
      const nodeIds = new Set(schema.nodes.map((n) => n.id));
      for (const edge of schema.edges) {
        if (!nodeIds.has(edge.from)) {
          throw new BadRequestException(
            'GRAPH_EDGE_NOT_FOUND',
            `Edge references non-existent source node: ${edge.from}`,
          );
        }
        if (!nodeIds.has(edge.to)) {
          throw new BadRequestException(
            'GRAPH_EDGE_NOT_FOUND',
            `Edge references non-existent target node: ${edge.to}`,
          );
        }
      }
    }

    for (const node of schema.nodes) {
      if (!this.templateRegistry.hasTemplate(node.template)) {
        throw new BadRequestException(
          'TEMPLATE_NOT_REGISTERED',
          `Template '${node.template}' is not registered`,
        );
      }
      this.templateRegistry.validateTemplateConfig(node.template, node.config);
    }

    const nodeMap = new Map(schema.nodes.map((n) => [n.id, n]));
    for (const node of schema.nodes) {
      if (node.config && typeof node.config === 'object') {
        const config = node.config as Record<string, unknown>;
        if (Array.isArray((config as any).resourceNodeIds)) {
          for (const resourceNodeId of (config as any)
            .resourceNodeIds as string[]) {
            const resourceNode = nodeMap.get(resourceNodeId);
            if (!resourceNode) {
              throw new BadRequestException(
                'GRAPH_NODE_NOT_FOUND',
                `Node '${node.id}' references non-existent resource node: ${resourceNodeId}`,
              );
            }

            const resourceTemplate = this.templateRegistry.getTemplate(
              resourceNode.template,
            );
            if (
              !resourceTemplate ||
              resourceTemplate.kind !== NodeKind.Resource
            ) {
              throw new BadRequestException(
                'GRAPH_NODE_NOT_FOUND',
                `Node '${node.id}' references node '${resourceNodeId}' which is not a resource node`,
              );
            }

            if (node.template === 'shell-tool') {
              if (resourceNode.template !== 'github-resource') {
                throw new BadRequestException(
                  'WRONG_EDGE_CONNECTION',
                  `Shell tool '${node.id}' can only use shell-compatible resources, but '${resourceNodeId}' is not a shell resource`,
                );
              }
            }
          }
        }
      }
    }
  }

  async compile(
    entity: GraphEntity,
    additionalMetadata?: Partial<GraphMetadataSchemaType>,
  ): Promise<CompiledGraph> {
    const schema = entity.schema;
    const metadata: GraphMetadataSchemaType = {
      name: entity.name,
      version: entity.version,
      graphId: entity.id,
      ...(additionalMetadata || {}),
    };

    const graphId = metadata.graphId || 'unknown';

    this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: { state: 'compiling', schema },
    });

    this.validateSchema(schema);

    const compiledNodes = new Map<string, CompiledGraphNode>();
    const nodesByKind = groupBy(schema.nodes, (node) => {
      const template = this.templateRegistry.getTemplate(node.template);
      if (!template) {
        throw new BadRequestException(
          'GRAPH_TEMPLATE_NOT_FOUND',
          `Template '${node.template}' not found`,
        );
      }
      return template.kind;
    });
    const buildOrder = [
      NodeKind.Resource,
      NodeKind.Runtime,
      NodeKind.Tool,
      NodeKind.SimpleAgent,
      NodeKind.Trigger,
    ];

    for (const kind of buildOrder) {
      const nodes = nodesByKind[kind] || [];
      for (const node of nodes) {
        const compiledNode = await this.compileNode(
          node,
          compiledNodes,
          metadata,
        );
        compiledNodes.set(node.id, compiledNode);
      }
    }

    this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: { state: 'compiled', schema },
    });

    return {
      nodes: compiledNodes,
      edges: schema.edges || [],
      destroy: async () => {
        await this.destroyGraph(compiledNodes);
        this.notificationsService.emit({
          type: NotificationEvent.Graph,
          graphId,
          data: { state: 'destroyed', schema },
        });
      },
    };
  }

  private async destroyGraph(
    nodes: Map<string, CompiledGraphNode>,
  ): Promise<void> {
    const destroyPromises: Promise<void>[] = [];
    const triggerNodes: CompiledGraphNode<BaseTrigger<any>>[] = [];
    const runtimeNodes: CompiledGraphNode<BaseRuntime>[] = [];

    for (const node of nodes.values()) {
      if (node.type === NodeKind.Trigger) {
        triggerNodes.push(node as CompiledGraphNode<BaseTrigger<any>>);
      } else if (node.type === NodeKind.Runtime) {
        runtimeNodes.push(node as CompiledGraphNode<BaseRuntime>);
      }
    }

    for (const node of triggerNodes) {
      const trigger = node.instance;
      if (trigger && typeof trigger.stop === 'function') {
        destroyPromises.push(
          trigger.stop().catch((error: Error) => {
            this.logger.error(error, `Failed to stop trigger ${node.id}`);
          }),
        );
      }
    }

    await Promise.all(destroyPromises);

    const runtimePromises: Promise<void>[] = [];
    for (const node of runtimeNodes) {
      const runtime = node.instance;
      if (runtime && typeof runtime.stop === 'function') {
        const stopPromise = Promise.race([
          runtime.stop(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Runtime stop timeout')), 15000),
          ),
        ]).catch((error: Error) => {
          this.logger.error(error, `Failed to stop runtime ${node.id}`);
        });
        runtimePromises.push(stopPromise);
      }
    }

    await Promise.all(runtimePromises);
  }

  async destroyNotCompiledGraph(graph: GraphEntity): Promise<void> {
    const runtimeNodes = graph.schema.nodes.filter(
      (node) => node.template === 'docker-runtime',
    );
    if (runtimeNodes.length === 0) return;

    this.logger.log(
      `Destroying ${runtimeNodes.length} runtime containers for graph ${graph.id} without compilation`,
    );

    await DockerRuntime.cleanupByLabels(
      { 'ai-company/graph_id': graph.id },
      { socketPath: environment.dockerSocket },
    );
  }

  private async compileNode(
    node: GraphNodeSchemaType,
    compiledNodes: Map<string, CompiledGraphNode>,
    metadata: GraphMetadataSchemaType,
  ): Promise<CompiledGraphNode> {
    const config = this.templateRegistry.validateTemplateConfig(
      node.template,
      node.config,
    );

    const template = this.templateRegistry.getTemplate(node.template);
    if (!template) {
      throw new BadRequestException(
        'GRAPH_TEMPLATE_NOT_FOUND',
        `Template '${node.template}' not found`,
      );
    }

    const instance = await template.create(config, compiledNodes, {
      ...metadata,
      nodeId: node.id,
    });

    return {
      id: node.id,
      type: template.kind,
      template: node.template,
      instance,
    };
  }
}
