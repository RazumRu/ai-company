import { z } from 'zod';

import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { IBaseResourceOutput } from '../../graph-resources/graph-resources.types';
import {
  CompiledGraphNode as _CompiledGraphNode,
  GraphMetadataSchemaType,
  NodeKind,
} from '../../graphs/graphs.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';

export interface NodeBaseTemplateMetadata extends GraphMetadataSchemaType {
  nodeId: string;
}

export type NodeConnection =
  | { type: 'kind'; value: NodeKind; required?: boolean; multiple: boolean }
  | { type: 'template'; value: string; required?: boolean; multiple: boolean };

export abstract class NodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TOutput = unknown,
> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly kind: NodeKind;
  abstract readonly schema: TConfig;

  readonly inputs: readonly NodeConnection[] = [];
  readonly outputs: readonly NodeConnection[] = [];

  /**
   * Create a node instance.
   * @param config - Validated configuration for the node
   * @param inputNodeIds - Set of input node IDs (nodes that connect TO this node)
   * @param outputNodeIds - Set of output node IDs (nodes that this node connects TO)
   * @param metadata - Graph metadata including graphId for looking up nodes dynamically
   */
  abstract create(
    config: z.infer<TConfig>,
    inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<TOutput>;
}

export abstract class RuntimeNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
> extends NodeBaseTemplate<TConfig, BaseRuntime> {
  readonly kind: NodeKind = NodeKind.Runtime;
}

export abstract class ToolNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
> extends NodeBaseTemplate<TConfig, BuiltAgentTool[]> {
  readonly kind: NodeKind = NodeKind.Tool;
}

export abstract class ResourceNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TResult extends IBaseResourceOutput<unknown> = IBaseResourceOutput<unknown>,
> extends NodeBaseTemplate<TConfig, TResult> {
  readonly kind: NodeKind = NodeKind.Resource;
}

export abstract class SimpleAgentNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TResult = SimpleAgent,
> extends NodeBaseTemplate<TConfig, TResult> {
  readonly kind: NodeKind = NodeKind.SimpleAgent;
}

export abstract class TriggerNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TResult = BaseTrigger<TConfig>,
> extends NodeBaseTemplate<TConfig, TResult> {
  readonly kind: NodeKind = NodeKind.Trigger;
}
