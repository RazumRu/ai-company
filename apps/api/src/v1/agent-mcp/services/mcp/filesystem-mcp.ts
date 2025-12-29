import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';
import { basename } from 'path';

import { IMcpServerConfig } from '../../agent-mcp.types';
import { BaseMcp, McpToolMetadata } from '../base-mcp';

export interface FilesystemMcpConfig {
  readOnly: boolean;
}

@Injectable({ scope: Scope.TRANSIENT })
export class FilesystemMcp extends BaseMcp<FilesystemMcpConfig> {
  constructor(logger: DefaultLogger) {
    super(logger);
  }

  protected toolsMapping(): Map<string, McpToolMetadata> {
    const defaultDirectory = '/runtime-workspace';
    const readOnly = this.config?.readOnly ?? false;

    const mapping = new Map<string, McpToolMetadata>([
      [
        'list_allowed_directories',
        {
          getDetailedInstructions: () =>
            dedent`
            ### Overview
            Lists all allowed root directories that the filesystem MCP has access to. This is your first move - always check what you can access before exploring.

            ### When to Use
            - At the start of any filesystem operation to understand boundaries
            - When you get "access denied" errors and need to verify allowed paths
            - Before constructing absolute paths for other tools

            ### When NOT to Use
            - You already know the allowed directories from previous calls
            - You're working within a known allowed path

            ### Best Practices
            - Call this once at the beginning of your workflow
            - Store the result mentally to validate other paths
            - All file operations must be within these directories
          `,
          generateTitle: (): string => 'Listing allowed directories',
        },
      ],
      [
        'list_directory',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Lists contents of a directory (files and subdirectories). Returns names and types. Fast for exploring directory structure.

            ### When to Use
            - Quick directory exploration
            - Checking what files exist in a specific folder
            - Understanding immediate directory structure
            - Verifying a directory exists and is accessible

            ### When NOT to Use
            - Need full recursive tree → use \`directory_tree\`
            - Searching for specific patterns → use \`search_files\`
            - Need file metadata (size, dates) → use \`get_file_info\`

            ### Best Practices
            - Start broad: list root directory first
            - Then narrow: list specific subdirectories
            - Combine with \`directory_tree\` for deeper exploration
            - Use absolute paths (e.g., \`${defaultDirectory}/src\`)

            ### Example
            \`\`\`json
            {"path": "${defaultDirectory}"}
            \`\`\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const dirName = basename(args.path as string) || 'root';
            return `Listing directory: ${dirName}`;
          },
        },
      ],
      [
        'directory_tree',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Generates a recursive tree view of a directory structure. Essential for understanding project layout. Supports exclude patterns to filter out noise (node_modules, .git, dist, etc.).

            ### When to Use
            - Understanding project structure at the start
            - Getting an overview before making changes
            - Documenting codebase architecture
            - Finding where code is organized

            ### When NOT to Use
            - Looking for specific files by pattern → use \`search_files\`
            - Just need files in one directory → use \`list_directory\`
            - Very large repositories without excludes (will be slow and huge)

            ### Best Practices
            **ALWAYS exclude common build/dependency directories:**
            \`\`\`json
            {
              "path": "${defaultDirectory}",
              "excludePatterns": [
                "**/node_modules/**",
                "**/.git/**",
                "**/dist/**",
                "**/build/**",
                "**/.next/**",
                "**/coverage/**"
              ]
            }
            \`\`\`

            - Start with root directory + excludes for overview
            - Then focus on specific subdirectories without excludes
            - Keep exclude patterns to avoid token waste

            ### Common Exclude Patterns
            | Pattern | Purpose |
            |---------|---------|
            | \`**/node_modules/**\` | npm packages |
            | \`**/.git/**\` | Git internals |
            | \`**/dist/**\`, \`**/build/**\` | Build outputs |
            | \`**/.next/**\`, \`**/.nuxt/**\` | Framework caches |
            | \`**/coverage/**\` | Test coverage reports |
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const dirName = basename(args.path as string) || 'root';
            const excludePatterns = args.excludePatterns as
              | string[]
              | undefined;
            const hasExcludes = excludePatterns && excludePatterns.length > 0;
            return `Tree view: ${dirName}${hasExcludes ? ' (filtered)' : ''}`;
          },
        },
      ],
      [
        'search_files',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Recursively searches for files matching a glob pattern. Fast file discovery by name/extension. Returns absolute paths ready for use with other tools.

            ### When to Use
            - Finding all files of a specific type (*.ts, *.json, *.md)
            - Locating files by name pattern
            - Getting a list of files to process iteratively
            - Discovering test files, config files, or specific components

            ### When NOT to Use
            - Searching for content INSIDE files → this only matches filenames
            - Just need one directory's contents → use \`list_directory\`
            - Need the file tree structure → use \`directory_tree\`

            ### Best Practices
            **ALWAYS use exclude patterns for large repos:**
            \`\`\`json
            {
              "path": "${defaultDirectory}",
              "pattern": "**/*.ts",
              "excludePatterns": [
                "**/node_modules/**",
                "**/dist/**",
                "**/.git/**"
              ]
            }
            \`\`\`

            ### Common Patterns
            | Pattern | Matches |
            |---------|---------|
            | \`**/*.ts\` | All TypeScript files |
            | \`**/*.{ts,tsx}\` | TypeScript and TSX files |
            | \`**/*.test.ts\` | All test files |
            | \`**/components/**/*.tsx\` | All TSX in components dirs |
            | \`**/README.md\` | All README files |
            | \`**/*config*.{js,json}\` | All config files |

            ### Output
            Returns array of absolute paths:
            \`\`\`json
            {
              "files": [
                "${defaultDirectory}/src/index.ts",
                "${defaultDirectory}/src/utils.ts"
              ]
            }
            \`\`\`
          `,
          generateTitle: (args: Record<string, unknown>): string =>
            `Searching for: ${args.pattern}`,
        },
      ],
      [
        'get_file_info',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Gets file metadata: size, modification time, permissions, and type. Lightweight check without reading content.

            ### When to Use
            - Checking if a file exists before reading
            - Getting file size before deciding to read
            - Checking file timestamps
            - Verifying file type (file vs directory)

            ### When NOT to Use
            - Need file content → use \`read_text_file\`
            - Just checking existence → use \`list_directory\` on parent dir
            - Need content from multiple files → use \`read_multiple_files\`

            ### Best Practices
            - Use before reading large files to check size
            - Quick existence check
            - Verify file type before operations

            ### Example
            \`\`\`json
            {"path": "${defaultDirectory}/package.json"}
            \`\`\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const fileName = basename(args.path as string);
            return `Info: ${fileName}`;
          },
        },
      ],
      [
        'read_text_file',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Reads UTF-8 text files. Supports optional head (first N lines) or tail (last N lines) for large files. Primary tool for reading source code, configs, and documentation.

            ### When to Use
            - Reading source code files
            - Examining configuration files
            - Reading README or documentation
            - Getting file content before editing
            - Reading specific portions of large files

            ### When NOT to Use
            - Binary files (images, PDFs) → use \`read_media_file\` for images
            - Multiple files at once → use \`read_multiple_files\`
            - Very large log files → use tail parameter

            ### Parameters
            - \`path\`: Absolute path to file
            - \`head\`: Read first N lines (optional)
            - \`tail\`: Read last N lines (optional)
            - Don't use head+tail together

            ### Best Practices
            **1. Read targeted sections for large files:**
            \`\`\`json
            {"path": "${defaultDirectory}/large-file.ts", "head": 100}
            \`\`\`

            **2. Read logs from the end:**
            \`\`\`json
            {"path": "${defaultDirectory}/logs/app.log", "tail": 200}
            \`\`\`

            **3. Read config files completely:**
            \`\`\`json
            {"path": "${defaultDirectory}/package.json"}
            \`\`\`

            ### Common Workflow
            1. Use \`search_files\` to find files
            2. Use \`get_file_info\` to check size
            3. Use \`read_text_file\` with head/tail for large files
            4. Read completely for small files
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const fileName = basename(args.path as string);
            const range = args.head
              ? ` (first ${args.head} lines)`
              : args.tail
                ? ` (last ${args.tail} lines)`
                : '';
            return `Reading: ${fileName}${range}`;
          },
        },
      ],
      [
        'read_multiple_files',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Batch reads multiple text files in a single call. More efficient than reading files one by one. Returns content for each file.

            ### When to Use
            - Reading related config files together (package.json + tsconfig.json)
            - Loading multiple source files for analysis
            - Reading a set of files discovered by \`search_files\`
            - Any time you need 2+ files at once

            ### When NOT to Use
            - Just one file → use \`read_text_file\`
            - Very large files → read individually with head/tail
            - Binary/media files → use appropriate tools

            ### Best Practices
            **Group related files:**
            \`\`\`json
            {
              "paths": [
                "${defaultDirectory}/package.json",
                "${defaultDirectory}/tsconfig.json",
                "${defaultDirectory}/README.md"
              ]
            }
            \`\`\`

            **Process search results:**
            1. Use \`search_files\` with pattern
            2. Take returned paths array
            3. Pass to \`read_multiple_files\`

            ### Output
            Returns array of file contents in order:
            \`\`\`json
            {
              "files": [
                {"path": "...", "content": "..."},
                {"path": "...", "content": "..."}
              ]
            }
            \`\`\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const paths = args.paths as string[] | undefined;
            return `Reading ${paths?.length || 0} files`;
          },
        },
      ],
      [
        'read_media_file',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Reads images and audio files, returns base64-encoded content with MIME type. Useful for analyzing visual assets or audio files.

            ### When to Use
            - Reading images (PNG, JPG, GIF, etc.)
            - Reading audio files
            - Need base64 encoding of media
            - Processing visual assets

            ### When NOT to Use
            - Text files → use \`read_text_file\`
            - Video files (may be too large)
            - Just checking if media exists → use \`get_file_info\`

            ### Best Practices
            - Check file size with \`get_file_info\` first
            - Use for reasonable-sized media (< 5MB)
            - Returned base64 can be processed or analyzed

            ### Example
            \`\`\`json
            {"path": "${defaultDirectory}/assets/logo.png"}
            \`\`\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const fileName = basename(args.path as string);
            return `Reading media: ${fileName}`;
          },
        },
      ],
      [
        'create_directory',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Creates a new directory (and parent directories if needed). Safe to call on existing directories.

            ### When to Use
            - Creating new folder structure
            - Organizing generated files
            - Setting up project scaffolding
            - Before writing files to new locations

            ### When NOT to Use
            - Directory already exists (though it's safe to call)
            - Creating deeply nested structures → tool creates parents automatically

            ### Best Practices
            **Create before writing:**
            \`\`\`json
            {"path": "${defaultDirectory}/generated/components"}
            \`\`\`
            Then write files to that path.

            **Safe structure creation:**
            - Tool creates all parent directories
            - Won't error if directory exists
            - Use absolute paths

            ### Example Workflow
            1. Plan directory structure
            2. Create directories with this tool
            3. Use \`write_file\` to add files
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const dirName = basename(args.path as string);
            return `Creating directory: ${dirName}`;
          },
        },
      ],
      [
        'write_file',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Creates a new file or completely overwrites existing file. DESTRUCTIVE - replaces entire file content. Use with caution.

            ### When to Use
            - Creating new files from scratch
            - Generating code, configs, or documentation
            - Completely replacing file content
            - Writing small files (< 100 lines)

            ### When NOT to Use
            - Making selective edits → use \`edit_file\`
            - Updating specific parts → use \`edit_file\`
            - Large existing files → risk of data loss, use \`edit_file\`
            - **NEVER use for modifying existing code** → use \`edit_file\`

            ### ⚠️ DANGER
            - **OVERWRITES** entire file without confirmation
            - No undo - previous content is lost
            - For existing files, **ALWAYS** use \`edit_file\` instead

            ### Safe Use Cases
            **1. Creating new files:**
            \`\`\`json
            {
              "path": "${defaultDirectory}/generated/output.txt",
              "content": "hello world"
            }
            \`\`\`

            **2. Generating new code:**
            \`\`\`json
            {
              "path": "${defaultDirectory}/src/components/NewComponent.tsx",
              "content": "export const NewComponent = () => { ... }"
            }
            \`\`\`

            ### Best Practices
            - Check if file exists with \`get_file_info\` first
            - If file exists, use \`edit_file\` instead
            - Create parent directories with \`create_directory\` first
            - Use absolute paths
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const fileName = basename(args.path as string);
            return `Writing: ${fileName}`;
          },
        },
      ],
      [
        'move_file',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Moves or renames a file. Works for both moving between directories and renaming within the same directory.

            ### When to Use
            - Renaming files
            - Moving files to different directories
            - Organizing project structure
            - Refactoring file locations

            ### When NOT to Use
            - Moving directories (use shell tool)
            - Copying (this moves, doesn't copy)
            - Cross-filesystem moves (may not work)

            ### Best Practices
            **Renaming within directory:**
            \`\`\`json
            {
              "source": "${defaultDirectory}/old-name.ts",
              "destination": "${defaultDirectory}/new-name.ts"
            }
            \`\`\`

            **Moving to different directory:**
            \`\`\`json
            {
              "source": "${defaultDirectory}/src/utils.ts",
              "destination": "${defaultDirectory}/lib/utils.ts"
            }
            \`\`\`

            - Use absolute paths for both source and destination
            - Ensure destination directory exists
            - Verify source exists first with \`get_file_info\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const sourceName = basename(args.source as string);
            const destName = basename(args.destination as string);
            return sourceName === destName
              ? `Moving: ${sourceName}`
              : `Renaming: ${sourceName} → ${destName}`;
          },
        },
      ],
      [
        'edit_file',
        {
          getDetailedInstructions: (): string =>
            dedent`
            ### Overview
            Makes targeted edits to existing files using pattern matching. Finds \`oldText\` and replaces with \`newText\`. Supports dry-run preview, multiple edits, and whitespace normalization. **PREFERRED method for modifying existing files.**

            ### When to Use
            - Modifying existing code
            - Updating specific functions or blocks
            - Replacing imports, constants, or configs
            - Multiple related changes at once
            - Any edit where you know the text to find
            - **DEFAULT choice for editing existing files**

            ### When NOT to Use
            - Creating new files → use \`write_file\`
            - Deleting files → use shell or other tools
            - Binary files → not supported
            - oldText appears multiple times → make it more specific

            ### Best Practice: ALWAYS Use dryRun First
            **Step 1: Preview (dryRun: true)**
            \`\`\`json
            {
              "path": "${defaultDirectory}/src/utils.ts",
              "edits": [{
                "oldText": "export const old = 'value';",
                "newText": "export const new = 'updated';"
              }],
              "dryRun": true
            }
            \`\`\`

            **Step 2: Review the diff output**

            **Step 3: Apply (dryRun: false)**
            \`\`\`json
            {
              "path": "${defaultDirectory}/src/utils.ts",
              "edits": [{
                "oldText": "export const old = 'value';",
                "newText": "export const new = 'updated';"
              }],
              "dryRun": false
            }
            \`\`\`

            ### How It Works
            **Pattern Matching Features:**
            - Whitespace normalization (spaces/tabs flexible)
            - Indentation detection and preservation
            - Case-sensitive matching
            - Must be unique in file (errors on multiple matches)

            **Making oldText Unique:**
            - Include surrounding context lines
            - Include function signature + body
            - Include unique comments or strings

            ### Multiple Edits
            Apply several changes at once:
            \`\`\`json
            {
              "path": "${defaultDirectory}/config.ts",
              "edits": [
                {
                  "oldText": "const API_URL = 'dev';",
                  "newText": "const API_URL = 'prod';"
                },
                {
                  "oldText": "const DEBUG = true;",
                  "newText": "const DEBUG = false;"
                }
              ],
              "dryRun": true
            }
            \`\`\`

            ### Common Workflow
            1. Read file with \`read_text_file\`
            2. Identify exact text to replace
            3. Run \`edit_file\` with \`dryRun: true\`
            4. Review diff
            5. Run \`edit_file\` with \`dryRun: false\`

            ### Error Handling
            - "Multiple matches": Make oldText more specific with context
            - "No match found": Check whitespace, typos, file content
            - "File not found": Verify path with \`get_file_info\`
          `,
          generateTitle: (args: Record<string, unknown>): string => {
            const fileName = basename(args.path as string);
            const edits = args.edits as unknown[] | undefined;
            const editsCount = edits?.length || 0;
            const dryRunText = args.dryRun ? ' (preview)' : '';
            return `Editing: ${fileName} (${editsCount} change${editsCount > 1 ? 's' : ''})${dryRunText}`;
          },
        },
      ],
    ]);

    if (!readOnly) {
      return mapping;
    }

    // Read-only mode: expose only non-mutating filesystem tools.
    const readOnlyTools = new Set<string>([
      'list_allowed_directories',
      'list_directory',
      'directory_tree',
      'search_files',
      'get_file_info',
      'read_text_file',
      'read_multiple_files',
      'read_media_file',
    ]);

    return new Map(
      Array.from(mapping.entries()).filter(([name]) => readOnlyTools.has(name)),
    );
  }

  public getMcpConfig(_config: FilesystemMcpConfig): IMcpServerConfig {
    const instance = this.getRuntimeInstance();

    const defaultDirectory = instance?.getWorkdir() || '/';

    return {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', defaultDirectory],
      env: {}, // No special env needed
    };
  }

  public getDetailedInstructions(_config: FilesystemMcpConfig): string {
    return dedent`
    ### Filesystem MCP (@modelcontextprotocol/server-filesystem)

    Provides filesystem access inside allowed “root” directories.
    This MCP server runs inside the connected Docker runtime (not on the API host machine), so it can only see files that exist in that runtime’s filesystem.
    Paths are expected to be absolute. If you try to read outside allowed roots, you’ll get denied.

    ### First Move (always)
    Before doing anything clever, discover what you’re allowed to touch:
    Tool: \`list_allowed_directories\`
    Input:
    \`\`\`json
    {}
    \`\`\`

    If you’re not sure which tools exist (versions differ), list them:
    Tool: \`tools/list\` (client-level) and then call only the tools that are actually available.

    ### When to Use
    - Read code/config/docs inside workspace
    - Explore repo structure fast
    - Find files by glob pattern
    - Make safe, targeted edits with dry-run
    - Create/move files and directories as part of codegen or scaffolding

    ### When NOT to Use
    - You need arbitrary line ranges (this server supports head/tail, not “lines 1200–1280”)
    - You need to manipulate binaries (except image/audio via \`read_media_file\`)
    - You want to “search text inside files” (this server is file-glob search, not grep)

    ### Best Practices (how to not waste tokens and not brick the repo)

    **1) Discover → narrow → read**
    - \`directory_tree\` (with excludes) to understand layout
    - \`search_files\` to locate candidate files
    - \`read_text_file\` to read only what you need (use head/tail for huge files)

    **1.1) Shell tool working directory gotcha**
    If you created files using the Shell tool with relative paths, they were likely created under a per-thread working directory:
    \`/runtime-workspace/<threadId>\`
    If you can’t find a file, either:
    - list \`/runtime-workspace\` to locate your thread directory, or
    - use absolute paths when creating files (recommended) under \`/runtime-workspace\`.

    **2) Prefer batch reads**
    Use \`read_multiple_files\` for small configs you almost always need together (package.json, tsconfig, eslint).

    **3) Edits must be safe**
    - Use \`edit_file\` with \`dryRun: true\`
    - Make \`oldText\` unique enough to match once
    - If multiple matches happen, expand \`oldText\` with more surrounding context

    **4) Exclude garbage folders by default**
    Recommended exclude patterns:
    \`["**/node_modules/**","**/.git/**","**/dist/**","**/build/**","**/.next/**","**/coverage/**"]\`

    ### Output Expectations
    Tool calls typically return “content blocks” (usually text). Some clients may also surface structured JSON separately.
    Handle failures gracefully: tools may report errors as returned content rather than hard protocol errors, depending on client/server wiring.
  `;
  }
}
