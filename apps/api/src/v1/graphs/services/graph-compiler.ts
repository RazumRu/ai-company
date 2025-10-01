import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { groupBy } from 'lodash';
import { z } from 'zod';

import { CompiledGraph, CompiledGraphNode, NodeKind } from '../graphs.types';
import { TemplateRegistry } from './template-registry';

// Node configuration schema
export const GraphNodeSchema = z.object({
  id: z.string().describe('Unique identifier for this node'),
  template: z.string().describe('Template name registered in TemplateRegistry'),
  config: z
    .record(z.string(), z.unknown())
    .describe('Template-specific configuration'),
});

// Edge configuration schema
export const GraphEdgeSchema = z.object({
  from: z.string().describe('Source node ID'),
  to: z.string().describe('Target node ID'),
  label: z.string().optional().describe('Optional edge label'),
});

// Complete graph schema
export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema).optional(),
  metadata: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
});

export type GraphSchemaType = z.infer<typeof GraphSchema>;
export type GraphNodeSchemaType = z.infer<typeof GraphNodeSchema>;

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
  constructor(private readonly templateRegistry: TemplateRegistry) {}

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
  async compile(schema: GraphSchemaType): Promise<CompiledGraph> {
    this.validateSchema(schema);

    const compiledNodes = new Map<string, CompiledGraphNode>();
    const nodesByKind = groupBy(schema.nodes, 'kind');
    const buildOrder = [NodeKind.Runtime, NodeKind.Tool, NodeKind.SimpleAgent];

    for (const kind of buildOrder) {
      for (const node of nodesByKind[kind] || []) {
        const compiledNode = await this.compileNode(node, compiledNodes);
        compiledNodes.set(node.id, compiledNode);
      }
    }

    return {
      nodes: compiledNodes,
      edges: schema.edges || [],
      metadata: schema.metadata,
    };
  }

  /**
   * Compiles a single node using its template factory
   */
  private async compileNode(
    node: GraphNodeSchemaType,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<CompiledGraphNode> {
    const config = this.templateRegistry.validateTemplateConfig(
      node.template,
      node.config,
    );

    const template = this.templateRegistry.getTemplate(node.template);
    if (!template) {
      throw new BadRequestException(`Template '${node.template}' not found`);
    }

    const instance = await template.create(config, compiledNodes);

    return {
      id: node.id,
      type: template.kind,
      instance,
    };
  }
}
