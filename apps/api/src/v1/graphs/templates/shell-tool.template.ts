import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import { ShellTool } from '../../agent-tools/tools/shell.tool';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { CompiledGraphNode } from '../graphs.types';
import { ToolNodeBaseTemplate } from './base-node.template';

export const ShellToolSchema = z.object({
  runtimeNodeId: z.string().describe('Reference to runtime node'),
});

@Injectable()
export class ShellToolTemplate extends ToolNodeBaseTemplate<
  typeof ShellToolSchema
> {
  readonly name = 'shell-tool';
  readonly description = 'Shell execution tool';
  readonly schema = ShellToolSchema;

  constructor(private readonly shellTool: ShellTool) {
    super();
  }

  async create(
    config: z.infer<typeof ShellToolSchema>,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<DynamicStructuredTool> {
    const runtimeNode: CompiledGraphNode<BaseRuntime> | undefined =
      compiledNodes.get(config.runtimeNodeId) as CompiledGraphNode<BaseRuntime>;

    if (!runtimeNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Node ${config.runtimeNodeId} not found`,
      );
    }

    return this.shellTool.build({ runtime: runtimeNode.instance });
  }
}
