import { describe, expect, it } from 'vitest';

import {
  buildAgentInstructions,
  collectDeferredToolsList,
} from './agent-instructions.utils';

describe('buildAgentInstructions', () => {
  it('returns only base when all parts are undefined', () => {
    const result = buildAgentInstructions('base', {
      instructionBlockContent: undefined,
      deferredToolsList: undefined,
      toolGroupInstructionsText: undefined,
      toolInstructions: undefined,
      mcpInstructions: undefined,
    });
    expect(result).toBe('base');
  });

  it('joins all parts in the correct order when all are set', () => {
    const result = buildAgentInstructions('base', {
      instructionBlockContent: '<block1>',
      deferredToolsList: '<deferred>',
      toolGroupInstructionsText: '<group>',
      toolInstructions: '<tool>',
      mcpInstructions: '<mcp>',
    });
    expect(result).toBe(
      'base\n\n<block1>\n\n<deferred>\n\n<group>\n\n<tool>\n\n<mcp>',
    );
  });

  it('drops undefined parts and joins only present parts', () => {
    const result = buildAgentInstructions('base', {
      instructionBlockContent: undefined,
      deferredToolsList: '<deferred>',
      toolGroupInstructionsText: undefined,
      toolInstructions: '<tool>',
      mcpInstructions: undefined,
    });
    expect(result).toBe('base\n\n<deferred>\n\n<tool>');
  });
});

describe('collectDeferredToolsList', () => {
  it('returns undefined for an empty map', () => {
    const result = collectDeferredToolsList(new Map());
    expect(result).toBeUndefined();
  });

  it('returns correct format for a single tool', () => {
    const tools = new Map([
      ['my_tool', { description: 'Does something useful' }],
    ]);
    const result = collectDeferredToolsList(tools);
    expect(result).toBe(
      '<available-tools>\n**IMPORTANT:** The following tools are NOT yet loaded. Before responding that a capability is unavailable, call `tool_search` with relevant keywords to load them. Available tools:\n- my_tool: Does something useful\n</available-tools>',
    );
  });

  it('contains a directive sentence telling LLM to call tool_search before declaring a capability unavailable', () => {
    const tools = new Map([['some_tool', { description: 'A tool' }]]);
    const result = collectDeferredToolsList(tools);
    expect(result).toContain('tool_search');
    expect(result).toMatch(/Before|IMPORTANT/);
    expect(result).toContain('<available-tools>');
  });

  it('sorts multiple tools alphabetically by name', () => {
    const tools = new Map([
      ['zebra_tool', { description: 'Last alphabetically' }],
      ['alpha_tool', { description: 'First alphabetically' }],
      ['middle_tool', { description: 'In the middle' }],
    ]);
    const result = collectDeferredToolsList(tools);
    expect(result).toContain(
      '- alpha_tool: First alphabetically\n- middle_tool: In the middle\n- zebra_tool: Last alphabetically',
    );
  });

  it('wraps output in <available-tools> XML tags', () => {
    const tools = new Map([['some_tool', { description: 'A tool' }]]);
    const result = collectDeferredToolsList(tools);
    expect(result).toMatch(/^<available-tools>/);
    expect(result).toMatch(/<\/available-tools>$/);
  });
});
