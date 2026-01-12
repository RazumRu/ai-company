import { Injectable } from '@nestjs/common';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { FilesApplyChangesTool } from './files-apply-changes.tool';
import { FilesBaseToolConfig } from './files-base.tool';
import { FilesBuildTagsTool } from './files-build-tags.tool';
import { FilesCreateDirectoryTool } from './files-create-directory.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesEditTool, FilesEditToolConfig } from './files-edit.tool';
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
    const workdir = config.runtime.getWorkdir();

    const lines: string[] = [
      `You have access to file system tools for working with the repository at: ${workdir}`,
      '',
      '**🔍 Discovery Workflow:**',
      '1) Run `files_build_tags` for the repo (or relevant subpaths) before you rely on tag search.',
      '2) Use `files_search_tags` to quickly jump to relevant files/symbols.',
      '3) If tags are not enough, use `files_search_text` and/or `files_directory_tree` to locate code.',
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
      includeEditActions
        ? '- Read/search + create/modify/move/delete files and directories'
        : '- Read/search only (edit actions disabled)',
      includeEditActions
        ? '- Sketch-based editing with `files_edit` (use useSmartModel flag for retry)'
        : '',
      includeEditActions
        ? '- Exact text replacement with `files_apply_changes` (manual control)'
        : '',
      '- Build/search semantic tags for faster navigation',
      '',
      '**⚠️ Critical Rules:**',
      includeEditActions
        ? '- ALWAYS read file with `files_read` before editing (no exceptions)'
        : '- Tag search results can become stale after external changes',
      includeEditActions
        ? '- Try `files_edit` first, fallback to `files_apply_changes` if needed'
        : '- Rebuild tags after external repo changes',
      includeEditActions
        ? '- For `files_apply_changes`: copy EXACT text from `files_read`, never guess'
        : '',
      includeEditActions
        ? '- Use `files_write_file` ONLY for new files, not for editing existing files'
        : '',
      includeEditActions
        ? '- Rebuild tags with `files_build_tags` after file changes'
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
    ];

    if (includeEditActions) {
      const editToolConfig: FilesEditToolConfig = {
        runtime: config.runtime,
      };

      tools.push(
        this.filesCreateDirectoryTool.build(config, lgConfig),
        this.filesMoveFileTool.build(config, lgConfig),
        this.filesWriteFileTool.build(config, lgConfig),
        this.filesEditTool.build(editToolConfig, lgConfig),
        this.filesApplyChangesTool.build(config, lgConfig),
        this.filesDeleteTool.build(config, lgConfig),
      );
    }

    return tools;
  }
}
