import { Injectable } from '@nestjs/common';
import { BadRequestException, DefaultLogger } from '@packages/common';
import { groupBy } from 'lodash';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import {
  CompiledGraph,
  CompiledGraphNode,
  GraphMetadataSchemaType,
  GraphNodeSchemaType,
  GraphSchemaType,
  NodeKind,
} from '../graphs.types';

/**
 * GraphCompiler is responsible for taking a graph schema (JSON)
 * and compiling it into executable nodes with proper dependency resolution.
 *
 * It handles:
 * - Validating graph schema with Zod
 * - Building runtime instances
 * - Resolving and building tools with configuration
 * - Creating agent instances with injected dependencies
 */
@Injectable()
export class GraphCompiler {
  constructor(
    private readonly templateRegistry: TemplateRegistry,
    private readonly logger: DefaultLogger,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Validates that all node IDs are unique
   */
  private validateSchema(schema: GraphSchemaType): void {
    const ids = schema.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);

    if (ids.length !== uniqueIds.size) {
      throw new BadRequestException('Duplicate node IDs found in graph schema');
    }

    if (schema.edges) {
      const nodeIds = new Set(schema.nodes.map((n) => n.id));

      for (const edge of schema.edges) {
        if (!nodeIds.has(edge.from)) {
          throw new BadRequestException(
            `Edge references non-existent source node: ${edge.from}`,
          );
        }
        if (!nodeIds.has(edge.to)) {
          throw new BadRequestException(
            `Edge references non-existent target node: ${edge.to}`,
          );
        }
      }
    }

    for (const node of schema.nodes) {
      if (!this.templateRegistry.hasTemplate(node.template)) {
        throw new BadRequestException(
          `Template '${node.template}' is not registered`,
        );
      }

      this.templateRegistry.validateTemplateConfig(node.template, node.config);
    }
  }

  /**
   * Compiles a graph schema into an executable graph structure
   */
  async compile(
    schema: GraphSchemaType,
    additionalMetadata?: Partial<GraphMetadataSchemaType>,
  ): Promise<CompiledGraph> {
    const metadata = {
      ...(schema.metadata || {}),
      ...(additionalMetadata || {}),
    };

    const graphId = metadata.graphId || 'unknown';

    this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: {
        state: 'compiling',
        schema,
      },
    });

    this.validateSchema(schema);

    const compiledNodes = new Map<string, CompiledGraphNode>();
    const nodesByKind = groupBy(schema.nodes, (node) => {
      const template = this.templateRegistry.getTemplate(node.template);
      if (!template) {
        throw new BadRequestException(`Template '${node.template}' not found`);
      }
      return template.kind;
    });
    const buildOrder = [
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
          schema.metadata,
        );
        compiledNodes.set(node.id, compiledNode);
      }
    }

    this.notificationsService.emit({
      type: NotificationEvent.Graph,
      graphId,
      data: {
        state: 'compiled',
        schema,
      },
    });

    return {
      nodes: compiledNodes,
      edges: schema.edges || [],
      destroy: async () => {
        await this.destroyGraph(compiledNodes);

        this.notificationsService.emit({
          type: NotificationEvent.Graph,
          graphId,
          data: {
            state: 'destroyed',
            schema,
          },
        });
      },
    };
  }

  /**
   * Destroys a compiled graph and all its resources
   */
  private async destroyGraph(
    nodes: Map<string, CompiledGraphNode>,
  ): Promise<void> {
    const destroyPromises: Promise<void>[] = [];

    // Group nodes by kind for ordered destruction
    const triggerNodes: CompiledGraphNode<BaseTrigger<any>>[] = [];
    const runtimeNodes: CompiledGraphNode<BaseRuntime>[] = [];

    for (const node of nodes.values()) {
      if (node.type === NodeKind.Trigger) {
        triggerNodes.push(node as CompiledGraphNode<BaseTrigger<any>>);
      } else if (node.type === NodeKind.Runtime) {
        runtimeNodes.push(node as CompiledGraphNode<BaseRuntime>);
      }
    }

    // First, stop all triggers
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

    // Wait for all triggers to stop
    await Promise.all(destroyPromises);

    // Then, destroy all runtimes
    const runtimePromises: Promise<void>[] = [];
    for (const node of runtimeNodes) {
      const runtime = node.instance;
      if (runtime && typeof runtime.stop === 'function') {
        // Add timeout to prevent hanging
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

    // Wait for all runtimes to be destroyed
    await Promise.all(runtimePromises);
  }

  /**
   * Compiles a single node using its template factory
   */
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
      throw new BadRequestException(`Template '${node.template}' not found`);
    }

    const instance = await template.create(config, compiledNodes, {
      ...metadata,
      nodeId: node.id,
    });

    return {
      id: node.id,
      type: template.kind,
      instance,
    };
  }
}
