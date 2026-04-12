import { describe, expect, it } from 'vitest';

import { collectDeferredToolsList } from './agent-instructions.utils';

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
      '<available-tools>\nThe following tools are available but not yet loaded. Use tool_search to find and load the tools you need:\n- my_tool: Does something useful\n</available-tools>',
    );
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
