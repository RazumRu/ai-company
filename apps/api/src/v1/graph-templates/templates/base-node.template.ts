import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import {
  CompiledGraphNode,
  GraphMetadataSchemaType,
  NodeKind,
} from '../../graphs/graphs.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';

export interface NodeBaseTemplateMetadata extends GraphMetadataSchemaType {
  nodeId: string;
}

export abstract class NodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TOutput = unknown,
> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly kind: NodeKind;
  abstract readonly schema: TConfig;

  abstract create(
    config: z.infer<TConfig>,
    compiledNodes: Map<string, CompiledGraphNode>,
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
> extends NodeBaseTemplate<TConfig, DynamicStructuredTool> {
  readonly kind: NodeKind = NodeKind.Tool;
}

export interface SimpleAgentTemplateResult<TConfig> {
  agent: SimpleAgent;
  config: TConfig;
}

export abstract class SimpleAgentNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TResult = SimpleAgentTemplateResult<z.infer<TConfig>>,
> extends NodeBaseTemplate<TConfig, TResult> {
  readonly kind: NodeKind = NodeKind.SimpleAgent;
}

export abstract class TriggerNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
  TResult = BaseTrigger<TConfig>,
> extends NodeBaseTemplate<TConfig, TResult> {
  readonly kind: NodeKind = NodeKind.Trigger;
}
