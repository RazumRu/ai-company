import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import type { BaseMcp } from '../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { SimpleAgentTemplateSchema } from '../../graph-templates/templates/agents/simple-agent.template';
import {
  SimpleAgentNodeBaseTemplate,
  ToolNodeOutput,
} from '../../graph-templates/templates/base-node.template';
import type { GraphNode } from '../../graphs/graphs.types';
import { NodeKind } from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import type { SystemAgentDefinition } from '../system-agents.types';

type SystemAgentSchemaType = z.infer<typeof SimpleAgentTemplateSchema> & {
  systemAgentId: string;
  systemAgentContentHash: string;
  additionalInstructions?: string;
};

@Injectable()
export class SystemAgentTemplateFactory {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly graphRegistry: GraphRegistry,
  ) {}

  createTemplate(
    def: SystemAgentDefinition,
  ): SimpleAgentNodeBaseTemplate<z.ZodTypeAny, SimpleAgent> {
    const schema = SimpleAgentTemplateSchema.extend({
      name: z
        .string()
        .min(1)
        .describe('Unique name for this agent')
        .default(def.name),
      instructions: z
        .string()
        .describe(
          'System prompt injected at the start of each turn: role, goals, constraints, style.',
        )
        .meta({ 'x-ui:textarea': true })
        .meta({ 'x-ui:ai-suggestions': true })
        .default(def.instructions),
      ...(def.defaultModel
        ? {
            invokeModelName: z
              .string()
              .describe(
                'Chat model used for the main reasoning/tool-call step.',
              )
              .meta({ 'x-ui:show-on-node': true })
              .meta({ 'x-ui:label': 'Model' })
              .meta({ 'x-ui:litellm-models-list-select': true })
              .default(def.defaultModel),
          }
        : {}),
      systemAgentId: z.string().default(def.id),
      systemAgentContentHash: z.string().default(def.contentHash),
      additionalInstructions: z
        .string()
        .optional()
        .describe(
          'Additional instructions appended to the predefined system prompt',
        )
        .meta({ 'x-ui:textarea': true })
        .meta({ 'x-ui:ai-suggestions': true }),
    });

    const moduleRef = this.moduleRef;
    const graphRegistry = this.graphRegistry;

    const template = new (class extends SimpleAgentNodeBaseTemplate<
      typeof schema,
      SimpleAgent
    > {
      readonly id = def.templateId;
      readonly name = def.name;
      readonly description = def.description;
      readonly schema = schema;
      readonly systemAgentId = def.id;
      readonly systemAgentContentHash = def.contentHash;
      readonly systemAgentPredefinedTools = def.tools;

      readonly inputs = [
        {
          type: 'template' as const,
          value: 'agent-communication-tool',
          multiple: true,
        },
        { type: 'kind' as const, value: NodeKind.Trigger, multiple: true },
      ] as const;

      readonly outputs = [
        { type: 'kind' as const, value: NodeKind.Tool, multiple: true },
        { type: 'kind' as const, value: NodeKind.Mcp, multiple: true },
      ] as const;

      async create() {
        return {
          provide: async (_params: GraphNode<SystemAgentSchemaType>) =>
            await this.createNewInstance(moduleRef, SimpleAgent),

          configure: async (
            params: GraphNode<SystemAgentSchemaType>,
            instance: SimpleAgent,
          ) => {
            const outputNodeIds = params.outputNodeIds;
            const graphId = params.metadata.graphId;
            const config = params.config;

            const allTools: BuiltAgentTool[] = [];
            const toolGroupInstructions: string[] = [];
            const mcpOutputs: BaseMcp<unknown>[] = [];

            for (const nodeId of outputNodeIds) {
              const node = graphRegistry.getNode<
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
                if (inst && typeof inst === 'object' && 'tools' in inst) {
                  const toolNodeOutput = inst as ToolNodeOutput;
                  allTools.push(...toolNodeOutput.tools);
                  if (toolNodeOutput.instructions) {
                    toolGroupInstructions.push(toolNodeOutput.instructions);
                  }
                } else {
                  const tools = Array.isArray(inst) ? inst : [inst];
                  tools.forEach((tool) =>
                    allTools.push(tool as BuiltAgentTool),
                  );
                }
                continue;
              }

              if (node.type === NodeKind.Mcp) {
                mcpOutputs.push(inst as BaseMcp<unknown>);
              }
            }

            instance.resetTools();
            allTools.forEach((tool) => instance.addTool(tool));

            const mcpInstructions = collectMcpInstructions(mcpOutputs);

            instance.setConfig(config);
            instance.setMcpServices(mcpOutputs);
            await instance.initTools(config);

            const toolInstructions = collectToolInstructions(
              instance.getTools() as BuiltAgentTool[],
            );
            const toolGroupInstructionsText = collectToolGroupInstructions(
              toolGroupInstructions,
            );

            const finalConfig = {
              ...config,
              instructions: [
                def.instructions,
                config.additionalInstructions,
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
    })();

    return template;
  }
}

function collectToolInstructions(tools: BuiltAgentTool[]): string | undefined {
  const toolBlocks = tools
    .filter((tool) => Boolean(tool.__instructions))
    .map((tool) =>
      wrapBlock(`### ${tool.name}\n${tool.__instructions}`, 'tool_description'),
    );

  if (!toolBlocks.length) {
    return undefined;
  }

  return ['## Tool Instructions', ...toolBlocks].join('\n\n');
}

function collectToolGroupInstructions(
  instructions: string[],
): string | undefined {
  if (!instructions.length) {
    return undefined;
  }

  const wrapped = instructions.map((block) =>
    wrapBlock(block, 'tool_group_instructions'),
  );

  return ['## Tool Group Instructions', ...wrapped].join('\n\n');
}

function collectMcpInstructions(
  mcpOutputs: BaseMcp<unknown>[],
): string | undefined {
  const blocks = mcpOutputs
    .map((mcp) => {
      const instructions = mcp.getDetailedInstructions?.(mcp.config as never);
      return instructions ? wrapBlock(instructions, 'mcp_instructions') : null;
    })
    .filter((block): block is string => Boolean(block));

  if (!blocks.length) {
    return undefined;
  }

  return ['## MCP Instructions', ...blocks].join('\n\n');
}

function wrapBlock(content: string, tag: string): string {
  return [`<${tag}>`, content, `</${tag}>`].join('\n');
}
