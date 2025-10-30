import { z } from 'zod';

export enum NodeKind {
  Runtime = 'runtime',
  Tool = 'tool',
  SimpleAgent = 'simpleAgent',
  Trigger = 'trigger',
  Resource = 'resource',
}

export enum GraphStatus {
  Created = 'created',
  Running = 'running',
  Stopped = 'stopped',
  Error = 'error',
}

export interface CompiledGraphNode<TInstance = unknown, TConfig = unknown> {
  id: string;
  type: NodeKind;
  template: string;
  instance: TInstance;
  config: TConfig;
}

export interface CompiledGraph {
  nodes: Map<string, CompiledGraphNode>;
  edges: {
    from: string;
    to: string;
    label?: string;
  }[];
  /**
   * Destroys the graph and cleans up all resources
   * - Stops all triggers
   * - Destroys all runtimes
   */
  destroy: () => Promise<void>;
}

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

export const GraphMetadataSchema = z.object({
  graphId: z.string(),
  name: z.string().optional(),
  version: z.string(),
  temporary: z.boolean().optional(),
});

// Complete graph schema
export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema).optional(),
});

export type GraphSchemaType = z.infer<typeof GraphSchema>;
export type GraphNodeSchemaType = z.infer<typeof GraphNodeSchema>;
export type GraphEdgeSchemaType = z.infer<typeof GraphEdgeSchema>;
export type GraphMetadataSchemaType = z.infer<typeof GraphMetadataSchema>;
