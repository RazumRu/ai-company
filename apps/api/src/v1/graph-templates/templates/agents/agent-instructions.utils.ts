import type { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';

export function wrapBlock(content: string, tag: string): string {
  return [`<${tag}>`, content, `</${tag}>`].join('\n');
}

export function collectToolInstructions(
  tools: BuiltAgentTool[],
): string | undefined {
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

export function collectToolGroupInstructions(
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

export function collectMcpInstructions(
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

export function collectInstructionBlockContent(
  instructionContents: string[],
): string | undefined {
  if (!instructionContents.length) {
    return undefined;
  }
  const wrapped = instructionContents.map((block) =>
    wrapBlock(block, 'instruction_block'),
  );
  return ['## Additional Instructions', ...wrapped].join('\n\n');
}

export type AgentInstructionParts = {
  instructionBlockContent: string | undefined;
  deferredToolsList: string | undefined;
  toolGroupInstructionsText: string | undefined;
  toolInstructions: string | undefined;
  mcpInstructions: string | undefined;
};

export const buildAgentInstructions = (
  baseInstructions: string,
  parts: AgentInstructionParts,
): string => {
  return [
    baseInstructions,
    parts.instructionBlockContent,
    parts.deferredToolsList,
    parts.toolGroupInstructionsText,
    parts.toolInstructions,
    parts.mcpInstructions,
  ]
    .filter(Boolean)
    .join('\n\n');
};

export function collectDeferredToolsList(
  deferredTools: Map<string, { description: string }>,
): string | undefined {
  if (deferredTools.size === 0) {
    return undefined;
  }

  const lines = Array.from(deferredTools.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { description }]) => `- ${name}: ${description}`);

  return wrapBlock(
    [
      '**IMPORTANT:** The following tools are NOT yet loaded. Before responding that a capability is unavailable, call `tool_search` with relevant keywords to load them. Available tools:',
      ...lines,
    ].join('\n'),
    'available-tools',
  );
}
