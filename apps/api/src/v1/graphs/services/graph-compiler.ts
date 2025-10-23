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

    // Generic edge-based validation: every edge must be between existing nodes and
    // must satisfy target's allowedTemplates rules
    const nodeMap = new Map(schema.nodes.map((n) => [n.id, n]));
    const edges = schema.edges || [];
    for (const edge of edges) {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from) {
        throw new BadRequestException(
          'GRAPH_EDGE_NOT_FOUND',
          `Edge references non-existent source node: ${edge.from}`,
        );
      }
      if (!to) {
        throw new BadRequestException(
          'GRAPH_EDGE_NOT_FOUND',
          `Edge references non-existent target node: ${edge.to}`,
        );
      }

      // Validate connection per target's constraints
      this.validateTemplateConnection(from.template, to.template);
    }

    // Validate required connections: templates with required=true in allowedTemplates must have at least one connection
    this.validateRequiredConnections(schema.nodes, edges);
  }

  /**
   * Validates that a template can connect to another template based on allowedTemplates and allowedTemplateKinds
   */
  private validateTemplateConnection(
    sourceTemplateName: string,
    targetTemplateName: string,
  ): void {
    const sourceTemplate =
      this.templateRegistry.getTemplate(sourceTemplateName);
    const targetTemplate =
      this.templateRegistry.getTemplate(targetTemplateName);

    if (!sourceTemplate || !targetTemplate) {
      return; // Let other validation handle missing templates
    }

    // Target template declares allowed incoming connections with discriminated union
    // allowedTemplates is now required - if empty array, no connections allowed
    if (targetTemplate.allowedTemplates) {
      if (targetTemplate.allowedTemplates.length === 0) {
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${targetTemplateName}' does not accept any connections (allowedTemplates is empty), but got '${sourceTemplateName}' (kind: ${sourceTemplate.kind})`,
        );
      }

      const isAllowed = targetTemplate.allowedTemplates.some((rule: any) => {
        if (!rule || typeof rule !== 'object') return false;
        if (rule.type === 'template') return rule.value === sourceTemplateName;
        if (rule.type === 'kind') return rule.value === sourceTemplate.kind;
        return false;
      });

      if (!isAllowed) {
        const rulesHuman = targetTemplate.allowedTemplates
          .map((r: any) => `${r.type}:${r.value}`)
          .join(', ');
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${targetTemplateName}' only accepts from [${rulesHuman}], but got '${sourceTemplateName}' (kind: ${sourceTemplate.kind})`,
        );
      }
    }
  }

  /**
   * Validates that templates with required=true in allowedTemplates have at least one connection
   */
  private validateRequiredConnections(nodes: any[], edges: any[]): void {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const node of nodes) {
      const template = this.templateRegistry.getTemplate(node.template);
      if (!template || !template.allowedTemplates) {
        continue;
      }

      // Find required connection rules
      const requiredRules = template.allowedTemplates.filter(
        (rule: any) => rule.required === true,
      );

      for (const rule of requiredRules) {
        // Check if this node has at least one connection matching the required rule
        const hasRequiredConnection = edges.some((edge) => {
          if (edge.to !== node.id) return false;

          const sourceNode = nodeMap.get(edge.from);
          if (!sourceNode) return false;

          const sourceTemplate = this.templateRegistry.getTemplate(
            sourceNode.template,
          );
          if (!sourceTemplate) return false;

          // Check if the source matches the required rule
          if (rule.type === 'template') {
            return rule.value === sourceNode.template;
          }
          if (rule.type === 'kind') {
            return rule.value === sourceTemplate.kind;
          }
          return false;
        });

        if (!hasRequiredConnection) {
          const ruleDescription =
            rule.type === 'template'
              ? `template '${rule.value}'`
              : `kind '${rule.value}'`;
          throw new BadRequestException(
            'MISSING_REQUIRED_CONNECTION',
            `Template '${node.template}' requires at least one connection from ${ruleDescription}, but none found`,
          );
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
    // Build adjacency of connected node IDs from edges (bidirectional)
    const adjacency = new Map<string, Set<string>>();
    const edges = schema.edges || [];
    for (const edge of edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
      adjacency.get(edge.from)!.add(edge.to);
      adjacency.get(edge.to)!.add(edge.from);
    }
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
          Array.from(adjacency.get(node.id) || []),
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
    connectedNodeIds: string[],
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

    // Create connected nodes map from connected node IDs
    const connectedNodes = new Map<string, CompiledGraphNode>();
    for (const connectedId of connectedNodeIds) {
      const connectedNode = compiledNodes.get(connectedId);
      if (connectedNode) {
        connectedNodes.set(connectedId, connectedNode);
      }
    }

    const instance = await template.create(config, connectedNodes, {
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
