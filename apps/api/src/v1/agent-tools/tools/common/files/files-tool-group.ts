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
import {
  FilesEditReapplyTool,
  FilesEditReapplyToolConfig,
} from './files-edit-reapply.tool';
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
  /**
   * Model to use for fast/efficient LLM parsing in files_edit.
   * Required when includeEditActions is true.
   */
  fastModel: string;
  /**
   * Model to use for smart/capable LLM parsing in files_edit_reapply.
   * Required when includeEditActions is true.
   */
  smartModel: string;
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
    private readonly filesEditReapplyTool: FilesEditReapplyTool,
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
      '**Workflow (important):**',
      '1) Run `files_build_tags` for the repo (or relevant subpaths) before you rely on tag search.',
      '2) Use `files_search_tags` to quickly jump to relevant files/symbols.',
      '3) If tags are not enough, use `files_search_text` and/or `files_directory_tree` to locate code.',
      '4) Use `files_read` to inspect exact code before making changes.',
      includeEditActions
        ? '5) **PRIMARY:** Use `files_edit` for sketch-based edits (preferred editing tool).'
        : '5) (Read-only) Do not attempt file modifications.',
      includeEditActions
        ? '6) **ON ERROR:** Use `files_edit_reapply` for smarter parsing, or fall back to `files_apply_changes` for manual oldText/newText edits.'
        : '',
      includeEditActions
        ? '7) **MANUAL:** Use `files_apply_changes` for exact oldText/newText control when needed.'
        : '',
      includeEditActions
        ? '8) After ANY file changes, rebuild tags with `files_build_tags` BEFORE using `files_search_tags` again.'
        : '6) If the repo changes externally, rebuild tags before using `files_search_tags` again.',
      '',
      '**Available Operations:**',
      includeEditActions
        ? '- Read/search + create/modify/move/delete files and directories'
        : '- Read/search only (edit actions disabled)',
      includeEditActions
        ? '- Sketch-based editing with `files_edit` (primary) and smart fallback with `files_edit_reapply`'
        : '',
      '- Build/search semantic tags for faster navigation',
      '',
      '**Notes:**',
      '- Tag search results can become stale after edits; rebuilding tags is required for correctness.',
      '- Prefer tags for large repos; fall back to text search when needed.',
      includeEditActions
        ? '- Use `files_edit` as primary editing tool; it provides better error messages and smart parsing.'
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
        fastModel: config.fastModel,
      };
      const reapplyToolConfig: FilesEditReapplyToolConfig = {
        runtime: config.runtime,
        smartModel: config.smartModel,
      };

      tools.push(
        this.filesCreateDirectoryTool.build(config, lgConfig),
        this.filesMoveFileTool.build(config, lgConfig),
        this.filesWriteFileTool.build(config, lgConfig),
        this.filesEditTool.build(editToolConfig, lgConfig),
        this.filesEditReapplyTool.build(reapplyToolConfig, lgConfig),
        this.filesApplyChangesTool.build(config, lgConfig),
        this.filesDeleteTool.build(config, lgConfig),
      );
    }

    return tools;
  }
}
