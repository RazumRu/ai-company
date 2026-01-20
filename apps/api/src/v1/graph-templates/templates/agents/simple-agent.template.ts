import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import {
  SimpleAgent,
  SimpleAgentSchema,
} from '../../../agents/services/agents/simple-agent';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  SimpleAgentNodeBaseTemplate,
  ToolNodeOutput,
} from '../base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema;

export type SimpleAgentTemplateSchemaType = z.infer<
  typeof SimpleAgentTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema,
  SimpleAgent
> {
  readonly id = 'simple-agent';
  readonly name = 'Simple agent';
  readonly description =
    'Configurable agent that can use connected tools and triggers';
  readonly schema = SimpleAgentTemplateSchema;

  readonly inputs = [
    {
      type: 'template',
      value: 'agent-communication-tool',
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Trigger,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.Tool,
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Mcp,
      multiple: true,
    },
  ] as const;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (_params: GraphNode<SimpleAgentTemplateSchemaType>) =>
        this.createNewInstance(this.moduleRef, SimpleAgent),
      configure: async (
        params: GraphNode<SimpleAgentTemplateSchemaType>,
        instance: SimpleAgent,
      ) => {
        const outputNodeIds = params.outputNodeIds;
        const graphId = params.metadata.graphId;
        const config = params.config;

        // Collect all tools from connected nodes
        const allTools: BuiltAgentTool[] = [];
        const toolGroupInstructions: string[] = [];
        const mcpOutputs: BaseMcp<unknown>[] = [];

        for (const nodeId of outputNodeIds) {
          const node = this.graphRegistry.getNode<
            | BuiltAgentTool
            | BuiltAgentTool[]
            | ToolNodeOutput
            | DynamicStructuredTool
            | DynamicStructuredTool[]
            | BaseMcp<unknown>
          >(graphId, nodeId);

          if (!node) {
            continue;
          }

          const inst = node.instance;

          if (node.type === NodeKind.Tool) {
            // Handle new ToolNodeOutput format
            if (inst && typeof inst === 'object' && 'tools' in inst) {
              const toolNodeOutput = inst as ToolNodeOutput;
              allTools.push(...toolNodeOutput.tools);
              if (toolNodeOutput.instructions) {
                toolGroupInstructions.push(toolNodeOutput.instructions);
              }
            } else {
              // Backward compatibility: handle old format
              const tools = Array.isArray(inst) ? inst : [inst];
              tools.forEach((tool) => allTools.push(tool as BuiltAgentTool));
            }
            continue;
          }

          if (node.type === NodeKind.Mcp) {
            const mcpService = inst as BaseMcp<unknown>;
            if (mcpService) {
              mcpOutputs.push(mcpService);
            }
          }
        }

        // Replace wiring (idempotent)
        instance.resetTools();
        allTools.forEach((tool) => instance.addTool(tool));

        const mcpInstructions = this.collectMcpInstructions(mcpOutputs);

        instance.setConfig(config);
        instance.setMcpServices(mcpOutputs);
        await instance.initTools(config);

        const toolInstructions = this.collectToolInstructions(
          instance.getTools() as BuiltAgentTool[],
        );
        const toolGroupInstructionsText = this.collectToolGroupInstructions(
          toolGroupInstructions,
        );

        const finalConfig = {
          ...config,
          instructions: [
            config.instructions,
            toolGroupInstructionsText,
            toolInstructions,
            mcpInstructions,
          ]
            .filter(Boolean)
            .join('\n\n'),
        };

        instance.setConfig(finalConfig);
      },
      destroy: async (instance: SimpleAgent) => {
        await instance.stop();
      },
    };
  }

  private collectToolInstructions(tools: BuiltAgentTool[]): string | undefined {
    // Collect individual tool instructions
    const toolBlocks = tools
      .filter((tool): tool is BuiltAgentTool => Boolean(tool))
      .map((tool) => {
        if (!tool.__instructions) {
          return null;
        }

        return this.wrapBlock(
          `### ${tool.name}\n${tool.__instructions}`,
          'tool_description',
        );
      })
      .filter((block): block is string => Boolean(block));

    if (!toolBlocks.length) {
      return undefined;
    }

    return ['## Tool Instructions', ...toolBlocks].join('\n\n');
  }

  private collectToolGroupInstructions(
    instructions: string[],
  ): string | undefined {
    if (!instructions.length) {
      return undefined;
    }

    const wrapped = instructions.map((block) =>
      this.wrapBlock(block, 'tool_group_instructions'),
    );

    return ['## Tool Group Instructions', ...wrapped].join('\n\n');
  }

  private collectMcpInstructions(
    mcpOutputs: BaseMcp<unknown>[],
  ): string | undefined {
    const blocks = mcpOutputs
      .map((mcp) => {
        const instructions = mcp.getDetailedInstructions?.(mcp.config as never);
        return instructions
          ? this.wrapBlock(instructions, 'mcp_instructions')
          : null;
      })
      .filter((block): block is string => Boolean(block));

    if (!blocks.length) {
      return undefined;
    }

    return ['## MCP Instructions', ...blocks].join('\n\n');
  }

  private wrapBlock(content: string, tag: string): string {
    return [`<${tag}>`, content, `</${tag}>`].join('\n');
  }
}
