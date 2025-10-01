import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { CompiledGraphNode, NodeKind } from '../graphs.types';

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

export abstract class SimpleAgentNodeBaseTemplate<
  TConfig extends z.ZodTypeAny,
> extends NodeBaseTemplate<TConfig, SimpleAgent> {
  readonly kind: NodeKind = NodeKind.SimpleAgent;
}
