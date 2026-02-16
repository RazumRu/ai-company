import { Injectable } from '@nestjs/common';

import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesFindPathsTool } from './files-find-paths.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTextTool } from './files-search-text.tool';
import { FilesWriteFileTool } from './files-write-file.tool';

export type FilesToolGroupConfig = FilesBaseToolConfig & {
  /**
   * Whether to include tools that can modify the filesystem (e.g. apply changes, delete files).
   * Defaults to true.
   */
  includeEditActions?: boolean;
};

@Injectable()
export class FilesToolGroup extends BaseToolGroup<FilesToolGroupConfig> {
  constructor(
    private readonly filesFindPathsTool: FilesFindPathsTool,
    private readonly filesDirectoryTreeTool: FilesDirectoryTreeTool,
    private readonly filesReadTool: FilesReadTool,
    private readonly filesSearchTextTool: FilesSearchTextTool,
    private readonly filesCodebaseSearchTool: FilesCodebaseSearchTool,
    private readonly filesWriteFileTool: FilesWriteFileTool,
    private readonly filesApplyChangesTool: FilesApplyChangesTool,
    private readonly filesDeleteTool: FilesDeleteTool,
  ) {
    super();
  }

  public getDetailedInstructions(
    config: FilesToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const includeEditActions = config.includeEditActions ?? true;
    const workdir = BASE_RUNTIME_WORKDIR;

    const editSection = includeEditActions
      ? [
          '',
          'Edit workflow: files_read (get current content) -> files_apply_changes (single or multi-edit)',
          '- files_apply_changes: precise oldText/newText replacement. Copy oldText verbatim from files_read output.',
          '- For multi-region edits, use the edits array: [{oldText, newText}, ...] to apply ALL changes atomically in ONE call.',
          '- NEVER pass the same text for oldText and newText — the edit must change something.',
          '- After editing a file, use postEditContext from the response or re-read with files_read before making another edit to the same file.',
          '- files_write_file: ONLY for creating new files.',
        ]
      : [
          '',
          'Read-only mode: use files_read to inspect code found via codebase_search.',
        ];

    const lines: string[] = [
      `File tools workspace: ${workdir}`,
      '',
      '⚠️ MANDATORY WORKFLOW — follow this order:',
      '',
      'STEP 1 — ALWAYS start with codebase_search:',
      '- After cloning a repo with gh_clone, your VERY FIRST action MUST be codebase_search.',
      '- Do NOT start with files_directory_tree or files_find_paths — these are slow, produce noisy output, and waste context.',
      '- codebase_search returns absolute file paths, code snippets, line ranges, and total_lines — everything you need to go straight to reading the relevant code.',
      '- Use multiple codebase_search calls with different queries to explore different aspects of the codebase.',
      '',
      'STEP 2 — Read files using paths from codebase_search:',
      '- Go DIRECTLY from codebase_search to files_read — do NOT call files_find_paths in between.',
      '- codebase_search paths are already absolute — no need to resolve or verify them.',
      '',
      '⚠️ CRITICAL — large file handling (NEVER ignore this):',
      '- codebase_search returns `total_lines` for each result. ALWAYS check it before reading.',
      '- Small files (≤300 lines): read entirely with files_read.',
      '- Large files (>300 lines): you MUST use fromLineNumber/toLineNumber in files_read. Use start_line/end_line from codebase_search ± 30 lines of padding. NEVER fetch the full content of a file with more than 300 lines — this wastes your context window and degrades your analysis quality.',
      '- If files_read returns lineCount > 300 and you did not use line ranges, you made an error. Re-read with a targeted range.',
      '',
      'Tool selection — use the RIGHT tool for each task:',
      '| Task | Tool | Notes |',
      '|---|---|---|',
      '| **Explore codebase** | **codebase_search** | **ALWAYS use first — mandatory starting point** |',
      '| Read files | files_read | Use paths from codebase_search; use line ranges for large files |',
      '| Exact text search | files_search_text | For regex/literal pattern matching after codebase_search |',
      '| Browse directory | files_find_paths | ONLY when you need to list files by glob — never for code discovery |',
      '| Directory overview | files_directory_tree | ONLY for structural overview — never as first exploration step |',
      '| Precise edit | files_apply_changes | exact oldText → newText |',
      '| Multi-region edit | files_apply_changes | edits array |',
      '| New file | files_write_file | |',
      '',
      'ANTI-PATTERNS — do NOT do these:',
      '- ❌ gh_clone → files_directory_tree → files_find_paths → files_read (skips codebase_search)',
      '- ❌ Reading a 500+ line file without fromLineNumber/toLineNumber',
      '- ❌ Using files_find_paths to find code when codebase_search would be faster and more precise',
      '- ❌ Doing 5+ sequential codebase_search/files_read calls yourself — use subagent explorers for broad research',
      '- ✅ gh_clone → codebase_search → files_read (with line ranges for large files)',
      '- ✅ For broad exploration (3+ files, 2+ modules): delegate to subagent explorers in parallel instead of searching yourself',
      '',
      'files_find_paths is ONLY for browsing directories by glob pattern when you need to list files by name/extension. NEVER use it for code discovery or to "verify" paths from codebase_search.',
      ...editSection,
    ];

    return lines.join('\n');
  }

  protected buildToolsInternal(
    config: FilesToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    const includeEditActions = config.includeEditActions ?? true;
    const tools: BuiltAgentTool[] = [
      this.filesFindPathsTool.build(config, lgConfig),
      this.filesDirectoryTreeTool.build(config, lgConfig),
      this.filesReadTool.build(config, lgConfig),
      this.filesSearchTextTool.build(config, lgConfig),
      this.filesCodebaseSearchTool.build(config, lgConfig),
    ];

    if (includeEditActions) {
      tools.push(
        this.filesWriteFileTool.build(config, lgConfig),
        this.filesApplyChangesTool.build(config, lgConfig),
        this.filesDeleteTool.build(config, lgConfig),
      );
    }

    return tools;
  }
}
