import { Injectable } from '@nestjs/common';
import { BadRequestException, DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { BaseAgent } from '../../agents/services/agents/base-agent';
import { SimpleAgentSchemaType } from '../../agents/services/agents/simple-agent';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import {
  NodeConnection,
  SimpleAgentTemplateResult,
} from '../../graph-templates/templates/base-node.template';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
import { GraphEntity } from '../entity/graph.entity';
import {
  CompiledGraph,
  CompiledGraphNode,
  GraphEdgeSchemaType,
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

    // Source template declares allowed outgoing connections with discriminated union
    // outputs is now required - if empty array, no connections allowed
    if (sourceTemplate.outputs) {
      if (sourceTemplate.outputs.length === 0) {
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${sourceTemplateName}' does not provide any connections (outputs is empty), but trying to connect to '${targetTemplateName}' (kind: ${targetTemplate.kind})`,
        );
      }

      const isAllowed = sourceTemplate.outputs.some((rule: NodeConnection) => {
        if (!rule || typeof rule !== 'object') return false;
        if (rule.type === 'template') return rule.value === targetTemplateName;
        if (rule.type === 'kind') return rule.value === targetTemplate.kind;
        return false;
      });

      if (!isAllowed) {
        const rulesHuman = sourceTemplate.outputs
          .map((r: NodeConnection) => `${r.type}:${r.value}`)
          .join(', ');
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${sourceTemplateName}' only provides to [${rulesHuman}], but trying to connect to '${targetTemplateName}' (kind: ${targetTemplate.kind})`,
        );
      }
    }

    // Target template declares allowed incoming connections with discriminated union
    // inputs is now required - if empty array, no connections allowed
    if (targetTemplate.inputs) {
      if (targetTemplate.inputs.length === 0) {
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${targetTemplateName}' does not accept any connections (inputs is empty), but got '${sourceTemplateName}' (kind: ${sourceTemplate.kind})`,
        );
      }

      const isAllowed = targetTemplate.inputs.some((rule: NodeConnection) => {
        if (!rule || typeof rule !== 'object') return false;
        if (rule.type === 'template') return rule.value === sourceTemplateName;
        if (rule.type === 'kind') return rule.value === sourceTemplate.kind;
        return false;
      });

      if (!isAllowed) {
        const rulesHuman = targetTemplate.inputs
          .map((r: NodeConnection) => `${r.type}:${r.value}`)
          .join(', ');
        throw new BadRequestException(
          'WRONG_EDGE_CONNECTION',
          `Template '${targetTemplateName}' only accepts from [${rulesHuman}], but got '${sourceTemplateName}' (kind: ${sourceTemplate.kind})`,
        );
      }
    }
  }

  /**
   * Validates that templates with required=true in outputs have at least one connection
   */
  private validateRequiredConnections(
    nodes: GraphNodeSchemaType[],
    edges: GraphEdgeSchemaType[],
  ): void {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const node of nodes) {
      const template = this.templateRegistry.getTemplate(node.template);
      if (!template || !template.outputs) {
        continue;
      }

      // Find required connection rules
      const requiredRules = template.outputs.filter(
        (rule: NodeConnection) => rule.required === true,
      );

      for (const rule of requiredRules) {
        // Check if this node has at least one connection matching the required rule
        const hasRequiredConnection = edges.some((edge) => {
          if (edge.from !== node.id) return false;

          const targetNode = nodeMap.get(edge.to);
          if (!targetNode) return false;

          const targetTemplate = this.templateRegistry.getTemplate(
            targetNode.template,
          );
          if (!targetTemplate) return false;

          // Check if the target matches the required rule
          if (rule.type === 'template') {
            return rule.value === targetNode.template;
          }
          if (rule.type === 'kind') {
            return rule.value === targetTemplate.kind;
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
            `Template '${node.template}' requires at least one connection to ${ruleDescription}, but none found`,
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
      temporary: entity.temporary,
      ...(additionalMetadata || {}),
    };

    const graphId = metadata.graphId || 'unknown';

    await this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: { state: 'compiling', schema },
    });

    this.validateSchema(schema);

    const compiledNodes = new Map<string, CompiledGraphNode>();
    const edges = schema.edges || [];

    const buildOrder = this.getBuildOrder(schema);

    for (const node of buildOrder) {
      const compiledNode = await this.compileNode(
        node,
        compiledNodes,
        metadata,
        edges,
      );
      compiledNodes.set(node.id, compiledNode);
    }

    await this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: { state: 'compiled', schema },
    });

    return {
      nodes: compiledNodes,
      edges: schema.edges || [],
      destroy: async () => {
        await this.destroyGraph(compiledNodes);
        await this.notificationsService.emit({
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
    const triggerNodes: CompiledGraphNode<BaseTrigger<unknown>>[] = [];
    const agentNodes: CompiledGraphNode<
      SimpleAgentTemplateResult<SimpleAgentSchemaType>
    >[] = [];
    const runtimeNodes: CompiledGraphNode<BaseRuntime>[] = [];

    for (const node of nodes.values()) {
      if (node.type === NodeKind.Trigger) {
        triggerNodes.push(node as CompiledGraphNode<BaseTrigger<unknown>>);
      } else if (node.type === NodeKind.SimpleAgent) {
        agentNodes.push(
          node as CompiledGraphNode<
            SimpleAgentTemplateResult<SimpleAgentSchemaType>
          >,
        );
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

    // Stop agents (cancel active LangGraph streams)
    const agentPromises: Promise<void>[] = [];
    for (const node of agentNodes) {
      const agentInstance = node.instance.agent;

      agentPromises.push(
        agentInstance.stop().catch((error: Error) => {
          this.logger.error(error, `Failed to stop agent ${node.id}`);
        }),
      );
    }

    await Promise.all(agentPromises);

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
    edges: GraphEdgeSchemaType[],
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

    // Create input and output nodes maps based on edge direction
    const inputNodes = new Map<string, CompiledGraphNode>();
    const outputNodes = new Map<string, CompiledGraphNode>();

    // Find edges where this node is the source (outputs) or target (inputs)
    const outgoingEdges = edges.filter((edge) => edge.from === node.id);
    const incomingEdges = edges.filter((edge) => edge.to === node.id);

    // Add nodes that this node connects to (its inputs)
    for (const edge of incomingEdges) {
      const inputNode = compiledNodes.get(edge.from);
      if (inputNode) {
        inputNodes.set(edge.from, inputNode);
      }
    }

    // Add nodes that this node provides for (its outputs)
    for (const edge of outgoingEdges) {
      const outputNode = compiledNodes.get(edge.to);
      if (outputNode) {
        outputNodes.set(edge.to, outputNode);
      }
    }

    const instance = await template.create(config, inputNodes, outputNodes, {
      ...metadata,
      nodeId: node.id,
    });

    return {
      id: node.id,
      type: template.kind,
      template: node.template,
      instance,
      config,
    };
  }

  /**
   * Returns the build order for the graph nodes using a dependency-based topological sort.
   * Throws if there are cycles.
   */
  private getBuildOrder(schema: GraphSchemaType): GraphNodeSchemaType[] {
    const edges = schema.edges || [];

    const dependsOn = new Map<string, Set<string>>();
    const dependents = new Map<string, Set<string>>();

    for (const node of schema.nodes) {
      dependsOn.set(node.id, new Set());
      dependents.set(node.id, new Set());
    }

    for (const edge of edges) {
      dependsOn.get(edge.from)!.add(edge.to);
      dependents.get(edge.to)!.add(edge.from);
    }

    const inDegree = new Map<string, number>();
    for (const node of schema.nodes) {
      inDegree.set(node.id, dependsOn.get(node.id)!.size);
    }

    const queue: GraphNodeSchemaType[] = [];
    for (const node of schema.nodes) {
      if (inDegree.get(node.id) === 0) {
        queue.push(node);
      }
    }

    const buildOrder: GraphNodeSchemaType[] = [];

    while (queue.length > 0) {
      const currentNode = queue.shift()!;
      buildOrder.push(currentNode);

      const currentDependents = dependents.get(currentNode.id)!;
      for (const dependentId of currentDependents) {
        const newInDegree = inDegree.get(dependentId)! - 1;
        inDegree.set(dependentId, newInDegree);

        if (newInDegree === 0) {
          const dependentNode = schema.nodes.find((n) => n.id === dependentId);
          if (dependentNode) {
            queue.push(dependentNode);
          }
        }
      }
    }

    if (buildOrder.length !== schema.nodes.length) {
      const processedIds = new Set(buildOrder.map((n) => n.id));
      const cycleNodes = schema.nodes
        .filter((n) => !processedIds.has(n.id))
        .map((n) => n.id);

      throw new BadRequestException(
        'GRAPH_CIRCULAR_DEPENDENCY',
        `Graph contains circular dependencies involving nodes: ${cycleNodes.join(', ')}`,
      );
    }

    return buildOrder;
  }
}
