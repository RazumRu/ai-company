import { ToolRunnableConfig } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BaseAgentConfigurable } from '../../../agents/agents.types';
import type { BuiltAgentTool } from '../base-tool';
import {
  DeferredToolEntry,
  TOOL_SEARCH_TOOL_NAME,
  ToolSearchTool,
  ToolSearchToolConfig,
} from './tool-search.tool';

const defaultRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
  configurable: { thread_id: 'thread-123' },
};

function makeMockTool(name: string, propNames: string[] = []): BuiltAgentTool {
  const properties: Record<string, unknown> = {};
  for (const prop of propNames) {
    properties[prop] = { type: 'string' };
  }

  return {
    name,
    description: '',
    invoke: vi.fn(),
    __ajvSchema: propNames.length > 0 ? { properties } : undefined,
  } as unknown as BuiltAgentTool;
}

function makeEntry(
  description: string,
  propNames: string[] = [],
  instructions?: string,
  toolName = 'mock-tool',
): DeferredToolEntry {
  return {
    tool: makeMockTool(toolName, propNames),
    description,
    instructions,
  };
}

function makeConfig(
  entries: Record<string, DeferredToolEntry>,
  loadToolFn?: (
    name: string,
  ) => { tool: BuiltAgentTool; instructions?: string } | null,
): ToolSearchToolConfig {
  const deferredTools = new Map<string, DeferredToolEntry>(
    Object.entries(entries),
  );
  const loadTool = loadToolFn ?? vi.fn().mockReturnValue(null);
  return { deferredTools, loadTool };
}

describe('ToolSearchTool', () => {
  let toolInstance: ToolSearchTool;

  beforeEach(() => {
    toolInstance = new ToolSearchTool();
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(toolInstance.name).toBe(TOOL_SEARCH_TOOL_NAME);
      expect(toolInstance.name).toBe('tool_search');
    });

    it('should have a non-empty description', () => {
      expect(toolInstance.description).toBeTruthy();
      expect(toolInstance.description.length).toBeGreaterThan(20);
    });

    it('should expose a static TOOL_NAME matching the instance name', () => {
      expect(ToolSearchTool.TOOL_NAME).toBe(toolInstance.name);
    });
  });

  describe('schema validation', () => {
    it('should accept a valid query string', () => {
      expect(() => toolInstance.validate({ query: 'shell' })).not.toThrow();
    });

    it('should reject an empty query string', () => {
      expect(() => toolInstance.validate({ query: '' })).toThrow();
    });

    it('should reject missing query field', () => {
      expect(() => toolInstance.validate({})).toThrow();
    });
  });

  describe('scoring and results', () => {
    it('should return exact name match with highest score (top result)', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands'),
        'shell-advanced': makeEntry('Advanced shell with scripting'),
        'web-search': makeEntry('Search the web'),
      });

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.at(0)?.name).toBe('shell');
    });

    it('should rank name keyword match higher than description-only match', () => {
      const config = makeConfig({
        'shell-exec': makeEntry('Execute commands in a container'),
        'file-ops': makeEntry(
          'shell-like file operations for reading and writing',
        ),
      });

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.at(0)?.name).toBe('shell-exec');
    });

    it('should return at most 5 results when more than 5 tools match', () => {
      const entries: Record<string, DeferredToolEntry> = {};
      for (let i = 0; i < 10; i++) {
        entries[`file-tool-${i}`] = makeEntry(
          `file operation tool number ${i}`,
        );
      }
      const config = makeConfig(entries);

      const result = toolInstance.invoke(
        { query: 'file' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBeLessThanOrEqual(5);
    });

    it('should match case-insensitively', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands'),
      });

      const result = toolInstance.invoke(
        { query: 'SHELL' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBe(1);
      expect(result.output.results.at(0)?.name).toBe('shell');
    });

    it('should score schema property name matches', () => {
      const withProp = makeEntry('Generic task tool', ['command'], undefined);
      withProp.tool = makeMockTool('task-runner', ['command']);

      const withoutProp = makeEntry('Another generic tool', []);
      withoutProp.tool = makeMockTool('generic-tool', []);

      const config = makeConfig({
        'task-runner': withProp,
        'generic-tool': withoutProp,
      });

      const result = toolInstance.invoke(
        { query: 'command' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.at(0)?.name).toBe('task-runner');
    });
  });

  describe('no matches', () => {
    it('should return a helpful message when no tools match', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands'),
      });

      const result = toolInstance.invoke(
        { query: 'zzz-nonexistent-xyz' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results).toHaveLength(0);
      expect(result.output.message).toContain('No tools found');
    });

    it('should NOT call loadTool when there are no matches', () => {
      const loadTool = vi.fn().mockReturnValue(null);
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
        ]),
        loadTool,
      };

      toolInstance.invoke(
        { query: 'zzz-nonexistent-xyz' },
        config,
        defaultRunnableConfig,
      );

      expect(loadTool).not.toHaveBeenCalled();
    });
  });

  describe('loadTool callback', () => {
    it('should call loadTool for each matching result', () => {
      const loadTool = vi.fn().mockReturnValue(null);
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
          ['shell-advanced', makeEntry('Advanced shell with scripting')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(loadTool).toHaveBeenCalledTimes(result.output.results.length);
      for (const match of result.output.results) {
        expect(loadTool).toHaveBeenCalledWith(match.name);
      }
    });

    it('should still include tool in results when loadTool returns null (already loaded)', () => {
      const loadTool = vi.fn().mockReturnValue(null);
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results).toHaveLength(1);
      expect(result.output.results.at(0)?.name).toBe('shell');
    });
  });

  describe('instruction embedding in output message', () => {
    it('should include instructions in output message for loaded tools that have instructions', () => {
      const instructions =
        'Always use absolute paths when invoking shell commands.';
      const loadTool = vi.fn().mockReturnValue({
        tool: makeMockTool('shell'),
        instructions,
      });
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.additionalMessages).toBeUndefined();
      expect(result.output.message).toContain('shell');
      expect(result.output.message).toContain(instructions);
      expect(result.output.message).toContain('## shell Instructions');
    });

    it('should NOT include instructions section in message for tools without instructions', () => {
      const loadTool = vi.fn().mockReturnValue({
        tool: makeMockTool('shell'),
        instructions: undefined,
      });
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.additionalMessages).toBeUndefined();
      expect(result.output.message).not.toContain('## shell Instructions');
    });

    it('should include one instructions block per matching tool that has instructions', () => {
      const loadTool = vi.fn().mockImplementation((name: string) => ({
        tool: makeMockTool(name),
        instructions: `Instructions for ${name}`,
      }));
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
          ['shell-safe', makeEntry('Safe shell execution mode')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.additionalMessages).toBeUndefined();
      expect(result.output.message).toContain('Instructions for shell');
      expect(result.output.message).toContain('Instructions for shell-safe');
    });
  });

  describe('messageMetadata.__loadedTools', () => {
    it('should include __loadedTools with names of successfully loaded tools', () => {
      const loadTool = vi.fn().mockImplementation((name: string) => ({
        tool: makeMockTool(name),
      }));
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
          ['shell-safe', makeEntry('Safe shell execution mode')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.messageMetadata).toBeDefined();
      expect(result.messageMetadata!.__loadedTools).toEqual(
        expect.arrayContaining(['shell', 'shell-safe']),
      );
    });

    it('should not include __loadedTools when loadTool returns null for all tools', () => {
      const loadTool = vi.fn().mockReturnValue(null);
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.messageMetadata).toBeUndefined();
    });

    it('should only include __loadedTools for tools where loadTool returned a value', () => {
      const loadTool = vi.fn().mockImplementation((name: string) => {
        if (name === 'shell') {
          return { tool: makeMockTool('shell') };
        }
        return null;
      });
      const config: ToolSearchToolConfig = {
        deferredTools: new Map([
          ['shell', makeEntry('Execute shell commands')],
          ['shell-safe', makeEntry('Safe shell execution mode')],
        ]),
        loadTool,
      };

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.messageMetadata!.__loadedTools).toEqual(['shell']);
    });

    it('should not set messageMetadata when there are no matches', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands'),
      });

      const result = toolInstance.invoke(
        { query: 'zzz-nonexistent' },
        config,
        defaultRunnableConfig,
      );

      expect(result.messageMetadata).toBeUndefined();
    });
  });

  describe('getDetailedInstructions', () => {
    it('should return a non-empty instruction string', () => {
      const config = makeConfig({});
      const instructions = toolInstance.getDetailedInstructions!(config);
      expect(instructions).toBeTruthy();
      expect(instructions.length).toBeGreaterThan(50);
    });

    it('should mention tool_search usage in instructions', () => {
      const config = makeConfig({});
      const instructions = toolInstance.getDetailedInstructions!(config);
      expect(instructions).toContain('tool_search');
    });
  });
});
