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
import { FilesCreateDirectoryTool } from './files-create-directory.tool';
import { FilesDeleteTool } from './files-delete.tool';
import { FilesDirectoryTreeTool } from './files-directory-tree.tool';
import { FilesEditTool } from './files-edit.tool';
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
      '╔══════════════════════════════════════════════════════════════════════════════╗',
      '║  🚨🚨🚨 MANDATORY RULE: YOU MUST USE codebase_search FIRST 🚨🚨🚨            ║',
      '╚══════════════════════════════════════════════════════════════════════════════╝',
      '',
      '**THIS IS A STRICT REQUIREMENT - NOT A SUGGESTION:**',
      '',
      'Before you call ANY other file tool (`files_directory_tree`, `files_find_paths`, `files_search_text`, `files_read`),',
      'you MUST FIRST call `codebase_search` to find relevant files and code.',
      '',
      '**VIOLATION OF THIS RULE IS NOT ACCEPTABLE.**',
      '',
      '**THE ONLY EXCEPTIONS where you may skip codebase_search:**',
      '1. You already know the EXACT file path from a previous codebase_search result',
      '2. The user explicitly provided the exact file path to read/edit',
      '3. You are performing a follow-up action on a file you already found via codebase_search',
      '',
      '**FOR ANY OF THESE TASKS, YOU MUST USE codebase_search FIRST:**',
      '- Finding where something is implemented',
      '- Exploring the codebase structure',
      '- Locating a class, function, or module',
      '- Understanding how a feature works',
      '- Finding related code',
      '- Answering "where is X?" questions',
      '- Looking for configuration files',
      '- Finding tests for a component',
      '',
      '**WHY THIS IS MANDATORY:**',
      '- `codebase_search` is 10-100x FASTER than directory browsing',
      '- It uses semantic search - finds code by intent, not just text matching',
      '- It searches the ENTIRE codebase instantly',
      '- Other tools require you to guess paths or browse slowly',
      '',
      '**CORRECT WORKFLOW (MUST FOLLOW):**',
      '```',
      '1. User asks about code → CALL codebase_search FIRST',
      '2. Get results from codebase_search → THEN call files_read on relevant files',
      '3. Need exact matches? → THEN call files_search_text (AFTER codebase_search)',
      '4. Need folder structure? → THEN call files_directory_tree (AFTER codebase_search)',
      '```',
      '',
      '**EXAMPLES:**',
      '',
      'User: "Find the authentication middleware"',
      '❌ WRONG: Call files_directory_tree or files_find_paths',
      '✅ CORRECT: Call codebase_search with query "authentication middleware implementation"',
      '',
      'User: "Where is the UserService class?"',
      '❌ WRONG: Call files_search_text with pattern "class UserService"',
      '✅ CORRECT: Call codebase_search with query "UserService class definition"',
      '',
      'User: "Show me how database connections work"',
      '❌ WRONG: Call files_directory_tree to browse for database files',
      '✅ CORRECT: Call codebase_search with query "database connection configuration setup"',
      '',
      includeEditActions
        ? '**✏️ Editing Workflow (after finding files with codebase_search):**'
        : '**📖 Read-Only Mode:**',
      includeEditActions
        ? '1. Use `files_read` to get current file content BEFORE any edit'
        : '- Use `files_read` to inspect exact code after finding it with codebase_search.',
      includeEditActions
        ? '2. Use `files_edit` (sketch-based) for most edits'
        : '',
      includeEditActions
        ? '3. Use `files_apply_changes` as fallback with exact oldText/newText'
        : '',
      includeEditActions
        ? '4. Use `files_write_file` ONLY for creating NEW files'
        : '',
      '',
      '**REMEMBER: codebase_search MUST be your FIRST tool call when exploring code.**',
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
