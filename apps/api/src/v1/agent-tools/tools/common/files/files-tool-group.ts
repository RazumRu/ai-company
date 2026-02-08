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
import { FilesMoveFileTool } from './files-move-file.tool';
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
    private readonly filesMoveFileTool: FilesMoveFileTool,
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
          '- For multi-region edits, use the edits array: [{oldText, newText}, ...] to apply multiple changes atomically.',
          '- files_write_file: ONLY for creating new files.',
        ]
      : [
          '',
          'Read-only mode: use files_read to inspect code found via codebase_search.',
        ];

    const lines: string[] = [
      `File tools workspace: ${workdir}`,
      '',
      'Discovery → Read workflow:',
      '1. codebase_search — semantic search, returns absolute file paths + code snippets. FIRST STEP for any "where is X?" question.',
      '2. files_read — read files using paths from codebase_search results. Go DIRECTLY from codebase_search to files_read — do NOT call files_find_paths in between.',
      '',
      'files_find_paths is ONLY for browsing directories by glob pattern when you don\'t know what files exist. NEVER use it to "verify" or "resolve" paths already returned by codebase_search.',
      '',
      'Tool selection:',
      '| Task | Tool |',
      '|---|---|',
      '| Discover code | codebase_search (semantic) → files_read |',
      '| Exact text search | files_search_text (regex) |',
      '| Read files | files_read (batch multiple, returns numbered lines) |',
      '| Precise edit | files_apply_changes (exact oldText → newText) |',
      '| Multi-region edit | files_apply_changes (edits array) |',
      '| New file | files_write_file |',
      '| Browse directory | files_find_paths (glob) |',
      '| Overview | files_directory_tree |',
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
        this.filesMoveFileTool.build(config, lgConfig),
        this.filesWriteFileTool.build(config, lgConfig),
        this.filesApplyChangesTool.build(config, lgConfig),
        this.filesDeleteTool.build(config, lgConfig),
      );
    }

    return tools;
  }
}
