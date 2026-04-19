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
        'shell-exec': makeEntry('Execute commands'),
        'file-ops': makeEntry('shell-like file operations'),
      });

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results).toHaveLength(1);
      expect(result.output.results.at(0)?.name).toBe('shell-exec');
    });

    it('should return at most 3 results when more than 3 tools match', () => {
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

      expect(result.output.results.length).toBeLessThanOrEqual(3);
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
      const withProp = makeEntry('Generic task tool', ['command']);
      withProp.tool = makeMockTool('command-runner', ['command']);

      const withoutProp = makeEntry('Another generic tool', []);
      withoutProp.tool = makeMockTool('generic-tool', []);

      const config = makeConfig({
        'command-runner': withProp,
        'generic-tool': withoutProp,
      });

      const result = toolInstance.invoke(
        { query: 'command' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.at(0)?.name).toBe('command-runner');
    });

    it('returns only name-matching tool when description-only competitors exist (query "shell")', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands'),
        gh_commit: makeEntry('Create a commit — invokes shell under the hood'),
        subagents_run_task: makeEntry(
          'Spawns a shell-based subagent task runner',
        ),
      });

      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBe(1);
      expect(result.output.results.at(0)?.name).toBe('shell');
    });

    it('returns only the shell tool when query has multiple description-matching terms (query "shell command execution")', () => {
      const config = makeConfig({
        shell: makeEntry('Execute shell commands with full execution control'),
        gh_commit: makeEntry(
          'Create a commit — invokes shell under the hood for command execution',
        ),
        subagents_run_task: makeEntry(
          'Spawns a shell-based subagent for command execution tasks',
        ),
      });

      const result = toolInstance.invoke(
        { query: 'shell command execution' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results).toHaveLength(1);
      expect(result.output.results.at(0)?.name).toBe('shell');
      expect(result.output.results.map((r) => r.name)).not.toContain(
        'gh_commit',
      );
      expect(result.output.results.map((r) => r.name)).not.toContain(
        'subagents_run_task',
      );
    });
  });

  describe('threshold filtering', () => {
    it('filters matches below 50% of top score', () => {
      // 'find-files' scores: name hit 'find' = 80, name hit 'files' = 80 → total 160
      // 'search-docs' scores: desc hit 'find' = 10, desc hit 'files' = 10 → total 20
      // topScore=160, minScore=80 → 'search-docs' at 20 is dropped
      const config = makeConfig({
        'find-files': makeEntry('Locate and list directory contents'),
        'search-docs': makeEntry('find files in a documentation repository'),
      });

      const result = toolInstance.invoke(
        { query: 'find files' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBe(1);
      expect(result.output.results.at(0)?.name).toBe('find-files');
    });

    it('filters matches below absolute floor of 30 when no strong match exists', () => {
      // 'only-tool' scores: desc hit 'token' = 10 → total 10 < floor 30 → filtered
      const config = makeConfig({
        'only-tool': makeEntry('This tool handles token validation'),
      });

      const result = toolInstance.invoke(
        { query: 'token' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBe(0);
      expect(result.output.message).toContain('No tools found');
    });
  });

  describe('no matches', () => {
    it('returns no-match message when deferredTools map is empty', async () => {
      const config: ToolSearchToolConfig = {
        deferredTools: new Map(),
        loadTool: vi.fn().mockReturnValue(null),
      };
      const result = toolInstance.invoke(
        { query: 'shell' },
        config,
        defaultRunnableConfig,
      );
      expect(result.output.results).toHaveLength(0);
      expect(result.output.message).toContain('No tools found');
    });

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

      // query 'shell safe': shell scores 80 (name:shell), shell-safe scores 160 (name:shell+name:safe)
      // topScore=160, minScore=80 — both meet the threshold
      const result = toolInstance.invoke(
        { query: 'shell safe' },
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

      // query 'shell safe': shell scores 80 (name:shell), shell-safe scores 160 (name:shell+name:safe)
      // topScore=160, minScore=80 — both meet the threshold
      const result = toolInstance.invoke(
        { query: 'shell safe' },
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

  // ----- Reproduction of field-observed behavior (Apr 18 threads 276319e9, a9abe921) -----
  describe('REPRO field-observed', () => {
    it('kitchen-sink query with gh_clone buried: does it appear in top 3?', () => {
      // Production-accurate descriptions copied verbatim from the actual tool source files.
      const config = makeConfig({
        gh_clone: makeEntry(
          'Clone a GitHub repository into the runtime container and return the absolute clone path for all subsequent operations. Also discovers and returns agent instruction files from the repository root — you MUST follow the rules they define. Supports optional branch/tag checkout, shallow cloning (depth), and custom clone destinations (workdir). If the repository is already cloned, navigate to the existing path instead of re-cloning.',
        ),
        shell: makeEntry(
          'Execute a shell command inside the runtime container and return its exit code, stdout, and stderr. Commands within the same thread share a persistent session, so environment variables and working directory changes (cd) persist across calls. Output is automatically truncated to fit within the configured token budget. Use this for git operations, build/test/install commands, and system inspection — but prefer specialized file tools (files_read, files_search_text, etc.) for reading, searching, and editing files.',
        ),
        codebase_search: makeEntry(
          'Preferred first step for codebase exploration. Perform semantic search across a git repository to find relevant code by meaning. Use natural-language queries (not single keywords) for best results. Returns file paths, line ranges, total_lines (file size), and code snippets ranked by relevance. Use this tool first after gh_clone — it is faster and more precise than files_directory_tree or files_find_paths. If indexing is in progress, partial results may be returned — supplement with other file tools for complete coverage. Check total_lines in results: read small files (≤300 lines) entirely, but for large files (>300 lines) ALWAYS use fromLineNumber/toLineNumber in files_read. The repository must be cloned first with gh_clone.',
        ),
        files_read: makeEntry('Read a file.'),
        files_directory_tree: makeEntry(
          'Generate a visual tree representation of a directory structure showing files and subdirectories. Prefer codebase_search first for code discovery — it is faster and more precise. Use this tool when you need a structural overview of the directory layout, or as a fallback when codebase_search indexing is in progress. Start with a shallow maxDepth (3-5) for large repositories. Common build/cache directories are excluded by default. Does not return file contents — use files_read for that.',
        ),
        files_find_paths: makeEntry(
          'Find file paths matching a glob pattern and return their absolute paths without reading file content. Prefer codebase_search for code discovery — it finds relevant code by meaning and returns paths with line numbers. Use this tool when you need to list files by name/extension pattern (e.g., "*.config.ts", "*migration*"), or as a fallback when codebase_search indexing is in progress. Returns up to maxResults paths (default 200). Common build/cache directories (node_modules, dist, .next, etc.) are excluded by default. Set includeSubdirectories=false to search only the specified directory without recursion.',
        ),
        files_search_text: makeEntry('Search text inside files.'),
        knowledge_search_docs: makeEntry('Search knowledge documents.'),
        knowledge_search_chunks: makeEntry(
          'Perform semantic search within specific knowledge documents and return the most relevant content snippets ranked by similarity to your query. Requires document public IDs obtained from knowledge_search_docs. Returns up to 20 chunk snippets with chunk IDs and relevance scores — use knowledge_get_chunks to retrieve full text for the most relevant chunks. Start with topK 3-7 for focused queries and increase if needed.',
        ),
        knowledge_get_chunks: makeEntry('Fetch full chunks by id.'),
      });

      const result = toolInstance.invoke(
        {
          query:
            'gh_clone files_read files_directory_tree files_find_paths files_search_text knowledge_search_docs knowledge_search_chunks knowledge_get_chunks shell',
        },
        config,
        defaultRunnableConfig,
      );

      const names = result.output.results.map((r) => r.name);
      // FIELD-OBSERVED: gh_clone was missing from top 3 even when named in query.
      expect(names).toContain('gh_clone');
    });

    it('exact-name query for a tool known to be deferred returns it', () => {
      // If communication_exec is in deferredTools, "communication_exec" should find it.
      const config = makeConfig({
        communication_exec: makeEntry(
          'Send a message to another agent in the system and receive their response.',
        ),
        web_search: makeEntry('Search the web.'),
      });

      const result = toolInstance.invoke(
        { query: 'communication_exec' },
        config,
        defaultRunnableConfig,
      );

      expect(result.output.results.length).toBeGreaterThan(0);
      expect(result.output.results.at(0)?.name).toBe('communication_exec');
    });
  });
});
