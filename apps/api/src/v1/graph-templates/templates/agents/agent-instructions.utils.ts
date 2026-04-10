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
