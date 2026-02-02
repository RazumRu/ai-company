import { Injectable } from '@nestjs/common';

import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesBuildTagsTool } from './files-build-tags.tool';
import { FilesCodebaseSearchTool } from './files-codebase-search.tool';
import { FilesCreateDirectoryTool } from './files-create-directory.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesEditTool } from './files-edit.tool';
import { FilesFindPathsTool } from './files-find-paths.tool';
import { FilesMoveFileTool } from './files-move-file.tool';
import { FilesReadTool } from './files-read.tool';
import { FilesSearchTagsTool } from './files-search-tags.tool';
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
    private readonly filesBuildTagsTool: FilesBuildTagsTool,
    private readonly filesSearchTagsTool: FilesSearchTagsTool,
    private readonly filesCodebaseSearchTool: FilesCodebaseSearchTool,
    private readonly filesCreateDirectoryTool: FilesCreateDirectoryTool,
    private readonly filesMoveFileTool: FilesMoveFileTool,
    private readonly filesWriteFileTool: FilesWriteFileTool,
    private readonly filesEditTool: FilesEditTool,
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

    const lines: string[] = [
      `You have access to file system tools for working with the repository at: ${workdir}`,
      '',
      '**🔍 Discovery Workflow (CRITICAL - Follow This):**',
      '**MANDATORY FIRST STEP:** Run `files_build_tags` once at the start of work in any repo/directory. This indexes all symbols (functions, classes, methods) for fast lookup.',
      '',
      '**PRIMARY SEARCH METHOD:** Use `files_search_tags` to find symbol definitions (functions, classes, methods). This is:',
      '- ⚡ **MUCH FASTER** than text search',
      '- 🎯 **MORE PRECISE** - finds exact definitions, not usages/comments',
      '- ✅ **PREFERRED** for code navigation and symbol lookup',
      '',
      '**WHEN TO USE EACH SEARCH TOOL:**',
      '1) **files_search_tags** (PREFERRED): Finding where functions/classes/methods are DEFINED',
      '   - Example: "Where is UserService defined?"',
      '   - Example: "Find the handleRequest method"',
      '   - Example: "Show me all React hooks (^use[A-Z])"',
      "2) **files_search_text** (FALLBACK): Finding usages, comments, strings, or when tags aren't built",
      '   - Example: "Where is UserService being called?"',
      '   - Example: "Find TODO comments"',
      '   - Example: "Search for API endpoint \'/users\'"',
      '3) **files_directory_tree** (OVERVIEW): Understanding project structure',
      '',
      '**TAG WORKFLOW:**',
      '1) Run `files_build_tags` once per repo/session (give it an alias like "project")',
      '2) Use `files_search_tags` for ALL symbol lookups (with the same alias)',
      '3) After file changes, rebuild tags before searching again',
      '',
      includeEditActions
        ? '**✏️ Editing Workflow (CRITICAL - Read This):**'
        : '**📖 Read-Only Mode (Read-only):**',
      includeEditActions
        ? '4) **MANDATORY FIRST STEP:** Use `files_read` to get current file content. NEVER edit without reading first.'
        : '4) Use `files_read` to inspect exact code.',
      includeEditActions
        ? '5) **PRIMARY TOOL:** Use `files_edit` (sketch-based) for most edits. Start with useSmartModel=false; retry with useSmartModel=true if needed.'
        : '',
      includeEditActions
        ? '6) **FALLBACK:** If `files_edit` fails, use `files_apply_changes` with exact oldText/newText copied from `files_read`.'
        : '',
      includeEditActions
        ? '7) **LAST RESORT:** Use `files_write_file` ONLY for creating new files. NEVER for modifying existing files.'
        : '',
      includeEditActions
        ? '8) After ANY file changes, rebuild tags with `files_build_tags` BEFORE using `files_search_tags` again.'
        : '5) If the repo changes externally, rebuild tags before using `files_search_tags` again.',
      '',
      '**📊 Tool Priority for Editing:**',
      includeEditActions
        ? '1. files_edit (preferred - handles multiple changes)'
        : '',
      includeEditActions
        ? '2. files_apply_changes (fallback - exact oldText/newText)'
        : '',
      includeEditActions
        ? '3. files_write_file (last resort - ONLY for new files)'
        : '',
      '',
      '**Available Operations:**',
      '- 🏷️ **TAG SEARCH (PRIMARY):** Build/search semantic tags for FAST symbol lookup',
      includeEditActions
        ? '- Read/search + create/modify/move/delete files and directories'
        : '- Read/search only (edit actions disabled)',
      includeEditActions
        ? '- Sketch-based editing with `files_edit` (use useSmartModel flag for retry)'
        : '',
      includeEditActions
        ? '- Exact text replacement with `files_apply_changes` (manual control)'
        : '',
      '',
      '**⚠️ Critical Rules:**',
      '- 🏷️ **ALWAYS build tags first** with `files_build_tags` at the start of work in a repo',
      '- 🔍 **PREFER `files_search_tags`** over `files_search_text` for finding symbol definitions',
      '- ♻️ **Rebuild tags** after file changes (new/modified/renamed files) before searching again',
      includeEditActions
        ? '- 📖 **ALWAYS read file** with `files_read` before editing (no exceptions)'
        : '- Tag search results can become stale after external changes',
      includeEditActions
        ? '- ✏️ **Try `files_edit` first**, fallback to `files_apply_changes` if needed'
        : '',
      includeEditActions
        ? '- 📝 **For `files_apply_changes`**: copy EXACT text from `files_read`, never guess'
        : '',
      includeEditActions
        ? '- ⚠️ **Use `files_write_file` ONLY for new files**, not for editing existing files'
        : '',
    ];

    return lines.filter(Boolean).join('\n');
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
      this.filesBuildTagsTool.build(config, lgConfig),
      this.filesSearchTagsTool.build(config, lgConfig),
      this.filesCodebaseSearchTool.build(config, lgConfig),
    ];

    if (includeEditActions) {
      tools.push(
        this.filesCreateDirectoryTool.build(config, lgConfig),
        this.filesMoveFileTool.build(config, lgConfig),
        this.filesWriteFileTool.build(config, lgConfig),
        this.filesEditTool.build(config, lgConfig),
        this.filesApplyChangesTool.build(config, lgConfig),
        this.filesDeleteTool.build(config, lgConfig),
      );
    }

    return tools;
  }
}
