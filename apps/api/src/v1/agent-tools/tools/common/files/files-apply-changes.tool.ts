import { Buffer } from 'node:buffer';
import { basename, dirname } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesApplyChangesToolEditSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe(
      'Text to search for (can be substring). Whitespace is normalized for matching.',
    ),
  newText: z
    .string()
    .describe(
      'Text to replace with. Indentation will be preserved from original.',
    ),
});

const FilesApplyChangesToolSchemaBase = z.object({
  path: z.string().min(1).describe('Absolute path to the file to edit'),
  edits: z
    .array(FilesApplyChangesToolEditSchema)
    .min(1)
    .describe('List of edit operations to perform'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Preview changes without applying them'),
});

export const FilesApplyChangesToolSchema = FilesApplyChangesToolSchemaBase;

// Use `z.input<>` so callers can omit defaulted fields like `dryRun`.
// (Defaults are still applied at runtime via Ajv useDefaults + JSON schema "default".)
export type FilesApplyChangesToolSchemaType = z.input<
  typeof FilesApplyChangesToolSchema
>;
export type FilesApplyChangesToolEditSchemaType = z.input<
  typeof FilesApplyChangesToolEditSchema
>;

type EditMatch = {
  editIndex: number;
  startLine: number;
  endLine: number;
  matchedText: string;
  indentation: string;
};

type FilesApplyChangesToolOutput = {
  error?: string;
  success?: boolean;
  diff?: string;
  appliedEdits?: number;
  totalEdits?: number;
};

@Injectable()
export class FilesApplyChangesTool extends FilesBaseTool<FilesApplyChangesToolSchemaType> {
  public name = 'files_apply_changes';
  public description =
    'Make selective edits to files using pattern matching instead of line numbers. Searches for oldText and replaces with newText. Supports multiple simultaneous edits, whitespace normalization, and indentation preservation. Use dryRun: true to preview changes before applying.';

  protected override generateTitle(
    args: FilesApplyChangesToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const name = basename(args.path);
    const editsCount = args.edits.length;
    const dryRunText = args.dryRun ? ' (preview)' : '';
    return `Editing ${name} (${editsCount} edit${editsCount > 1 ? 's' : ''})${dryRunText}`;
  }

  public get schema() {
    return z.toJSONSchema(FilesApplyChangesToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Makes selective edits using advanced pattern matching and formatting. Searches for text patterns and replaces them with new content. Features line-based and multi-line content matching, whitespace normalization with indentation preservation, and preview mode.

      ### Why Use Pattern Matching
      - **No line numbers needed**: Find text by content, not by counting lines
      - **More reliable**: Doesn't break when file changes elsewhere
      - **Better for LLMs**: Natural way to specify "replace this with that"
      - **Safer**: Always preview with dryRun first
      - **Multiple edits**: Apply several changes in one call

      ### When to Use
      - Modifying specific functions or code blocks by content
      - Replacing patterns across a file
      - Updating imports, configuration values, or constants
      - Making multiple related changes at once
      - Adding text to the beginning, middle, or end of a file
      - Creating new files from scratch
      - Any edit where you know what text to find (or file is empty)

      ### When NOT to Use
      - Deleting entire files → use \`files_delete\`
      - When oldText appears multiple times and you only want to change one → be more specific with oldText
      - For binary files → not supported

      ${parameterDocs}

      ### How Pattern Matching Works

      **1. Whitespace Normalization**
      - Extra spaces/tabs are normalized for matching
      - Indentation is detected and preserved in newText
      - Leading/trailing whitespace is flexible

      **2. Exact Substring Match**
      - oldText must be a substring of file content (after normalization)
      - Match is case-sensitive
      - Must be unique in the file (will error if multiple matches)

      **3. Indentation Preservation**
      - Tool detects indentation of matched text
      - Applies same indentation to newText
      - Works with tabs or spaces

      ### Best Practice: Always Use dryRun First

      **Step 1: Preview with dryRun: true**
      \`\`\`json
      {
        "path": "/repo/src/utils.ts",
        "edits": [
          {
            "oldText": "function oldName() {\\n  return 'old';\\n}",
            "newText": "function newName() {\\n  return 'new';\\n}"
          }
        ],
        "dryRun": true
      }
      \`\`\`

      Review the diff output to confirm changes are correct.

      **Step 2: Apply with dryRun: false**
      If the preview looks good, run again with \`dryRun: false\` (or omit it):
      \`\`\`json
      {
        "path": "/repo/src/utils.ts",
        "edits": [
          {
            "oldText": "function oldName() {\\n  return 'old';\\n}",
            "newText": "function newName() {\\n  return 'new';\\n}"
          }
        ]
      }
      \`\`\`

      ### Examples

      **Example 1: Simple function replacement**
      \`\`\`json
      {
        "path": "/repo/src/calculator.ts",
        "edits": [
          {
            "oldText": "function add(a, b) {\\n  return a + b;\\n}",
            "newText": "function add(a: number, b: number): number {\\n  return a + b;\\n}"
          }
        ],
        "dryRun": true
      }
      \`\`\`

      **Example 2: Multiple edits at once**
      \`\`\`json
      {
        "path": "/repo/src/config.ts",
        "edits": [
          {
            "oldText": "const API_URL = 'http://localhost:3000'",
            "newText": "const API_URL = 'https://api.production.com'"
          },
          {
            "oldText": "const DEBUG = true",
            "newText": "const DEBUG = false"
          }
        ]
      }
      \`\`\`

      **Example 3: Replacing import statement**
      \`\`\`json
      {
        "path": "/repo/src/components/Button.tsx",
        "edits": [
          {
            "oldText": "import { OldButton } from './old-button'",
            "newText": "import { NewButton } from './new-button'"
          }
        ]
      }
      \`\`\`

      **Example 4: Using partial text for matching**
      You don't need to include the entire function, just enough to uniquely identify it:
      \`\`\`json
      {
        "path": "/repo/src/user.service.ts",
        "edits": [
          {
            "oldText": "async getUserById(id: string) {\\n    return this.db.findOne({ id });",
            "newText": "async getUserById(id: string) {\\n    return this.db.findOne({ id, active: true });"
          }
        ]
      }
      \`\`\`

      **Example 5: Creating a new file (special case)**
      To create a new file, provide empty oldText:
      \`\`\`json
      {
        "path": "/repo/src/new-file.ts",
        "edits": [
          {
            "oldText": "",
            "newText": "export const hello = 'world';"
          }
        ]
      }
      \`\`\`

      **Example 6: Adding text to the end of a file**
      Read the file first, then include all current content in oldText:
      \`\`\`json
      {
        "path": "/repo/src/utils.ts",
        "edits": [
          {
            "oldText": "export function helper() {\\n  return true;\\n}",
            "newText": "export function helper() {\\n  return true;\\n}\\n\\nexport function newHelper() {\\n  return false;\\n}"
          }
        ]
      }
      \`\`\`

      **Example 7: Adding import to the beginning**
      Read the file first, then prepend to existing content:
      \`\`\`json
      {
        "path": "/repo/src/app.ts",
        "edits": [
          {
            "oldText": "import { existing } from './existing';\\n\\nconst app = 'app';",
            "newText": "import { existing } from './existing';\\nimport { newImport } from './new';\\n\\nconst app = 'app';"
          }
        ]
      }
      \`\`\`

      **Example 8: Inserting in the middle of a file**
      Find a unique marker and include surrounding context:
      \`\`\`json
      {
        "path": "/repo/src/config.ts",
        "edits": [
          {
            "oldText": "export const config = {\\n  api: 'http://localhost',\\n};",
            "newText": "export const config = {\\n  api: 'http://localhost',\\n  timeout: 5000,\\n};"
          }
        ]
      }
      \`\`\`

      **Example 9: Working with empty file**
      For completely empty files, use empty oldText:
      \`\`\`json
      {
        "path": "/repo/src/empty.ts",
        "edits": [
          {
            "oldText": "",
            "newText": "// First line of content\\nexport const data = 'value';"
          }
        ]
      }
      \`\`\`

      ### Output Format

      **Dry Run Output:**
      \`\`\`json
      {
        "success": true,
        "appliedEdits": 0,
        "totalEdits": 2,
        "diff": "@@ -10,3 +10,3 @@\\n-const API_URL = 'localhost'\\n+const API_URL = 'production'\\n@@ -25,2 +25,2 @@\\n-const DEBUG = true\\n+const DEBUG = false"
      }
      \`\`\`

      **Applied Output:**
      \`\`\`json
      {
        "success": true,
        "appliedEdits": 2,
        "totalEdits": 2
      }
      \`\`\`

      **Error Output:**
      \`\`\`json
      {
        "success": false,
        "error": "Edit 0: Could not find unique match for oldText. Found 3 matches."
      }
      \`\`\`

      ### Error Handling

      **"Could not find match"**
      - oldText doesn't exist in file
      - Check file content with \`files_read\` first
      - Verify text matches exactly (case-sensitive)

      **"Found multiple matches"**
      - oldText appears more than once in file
      - Include more context in oldText to make it unique
      - Add surrounding lines or more specific content

      **"File not found"**
      - Path is incorrect
      - Use \`files_list\` to find correct path
      - Check if file was moved or deleted

      ### Adding Text Without Replacing

      The tool supports three ways to add text:

      **1. To a New/Empty File**
      Use empty oldText:
      \`\`\`json
      {
        "path": "/repo/new.ts",
        "edits": [{ "oldText": "", "newText": "new content" }]
      }
      \`\`\`

      **2. To the Beginning**
      Read file first, then prepend to current content in newText:
      \`\`\`json
      {
        "oldText": "current content",
        "newText": "new line at top\\ncurrent content"
      }
      \`\`\`

      **3. To the End**
      Read file first, then append to current content in newText:
      \`\`\`json
      {
        "oldText": "current content",
        "newText": "current content\\nnew line at bottom"
      }
      \`\`\`

      **4. In the Middle**
      Find unique marker, include it in both oldText and newText with additions:
      \`\`\`json
      {
        "oldText": "line before\\nline after",
        "newText": "line before\\nNEW LINE HERE\\nline after"
      }
      \`\`\`

      ### Tips for Success

      1. **Read first**: Always use \`files_read\` to see current content before editing (unless creating new file)
      2. **Preview always**: Use \`dryRun: true\` to verify changes before applying
      3. **Be specific**: Include enough context in oldText to avoid multiple matches
      4. **Mind whitespace**: Don't worry too much about exact spacing - normalization handles it
      5. **Batch edits**: Multiple independent edits can be done in one call
      6. **Check output**: Review diff in dry run to ensure changes are correct
      7. **For additions**: Remember to read file first to get current content (except for new files)
    `;
  }

  private normalizeWhitespace(text: string): string {
    return text
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }

  private detectIndentation(line: string): string {
    const match = line.match(/^(\s+)/);
    return match && match[1] ? match[1] : '';
  }

  private applyIndentation(text: string, indentation: string): string {
    if (!indentation) return text;
    return text
      .split('\n')
      .map((line, index) => {
        // Don't indent empty lines or first line if original wasn't indented
        if (line.trim() === '' || (index === 0 && !text.startsWith('\n'))) {
          return line;
        }
        return indentation + line;
      })
      .join('\n');
  }

  private findMatches(
    fileContent: string,
    edits: FilesApplyChangesToolEditSchemaType[],
  ): { matches: EditMatch[]; errors: string[] } {
    const lines = fileContent.split('\n');
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = edits[editIndex];

      if (!edit) {
        continue;
      }

      // Special case: empty oldText means we're creating/replacing entire file
      if (edit.oldText === '') {
        continue;
      }

      const normalizedOldText = this.normalizeWhitespace(edit.oldText);
      const searchLines = normalizedOldText.split('\n');
      const searchLineCount = searchLines.length;

      const foundMatches: EditMatch[] = [];

      // Search through file for matches
      for (
        let lineIndex = 0;
        lineIndex <= lines.length - searchLineCount;
        lineIndex++
      ) {
        const candidateLines = lines.slice(
          lineIndex,
          lineIndex + searchLineCount,
        );
        const normalizedCandidate = this.normalizeWhitespace(
          candidateLines.join('\n'),
        );

        if (normalizedCandidate === normalizedOldText) {
          const lineAtIndex = lines[lineIndex];
          const indentation = lineAtIndex
            ? this.detectIndentation(lineAtIndex)
            : '';
          foundMatches.push({
            editIndex,
            startLine: lineIndex,
            endLine: lineIndex + searchLineCount - 1,
            matchedText: candidateLines.join('\n'),
            indentation,
          });
        }
      }

      if (foundMatches.length === 0) {
        errors.push(
          `Edit ${editIndex}: Could not find match for oldText in file.`,
        );
      } else if (foundMatches.length > 1) {
        errors.push(
          `Edit ${editIndex}: Found ${foundMatches.length} matches for oldText. Please be more specific to match uniquely.`,
        );
      } else if (foundMatches[0]) {
        matches.push(foundMatches[0]);
      }
    }

    return { matches, errors };
  }

  private generateDiff(
    originalLines: string[],
    matches: EditMatch[],
    edits: FilesApplyChangesToolEditSchemaType[],
  ): string {
    const diffParts: string[] = [];

    for (const match of matches) {
      const edit = edits[match.editIndex];
      if (!edit || edit.newText === undefined) continue;

      const contextBefore = 2;
      const contextAfter = 2;

      const startContext = Math.max(0, match.startLine - contextBefore);
      const endContext = Math.min(
        originalLines.length - 1,
        match.endLine + contextAfter,
      );

      const newTextLines = (edit?.newText ?? '').split('\n').length;
      diffParts.push(
        `@@ -${match.startLine + 1},${match.endLine - match.startLine + 1} +${match.startLine + 1},${newTextLines} @@`,
      );

      // Context before
      for (let i = startContext; i < match.startLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }

      // Old lines
      for (let i = match.startLine; i <= match.endLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(`-${line}`);
        }
      }

      // New lines
      if (edit) {
        const newTextWithIndent = this.applyIndentation(
          edit.newText,
          match.indentation,
        );
        for (const line of newTextWithIndent.split('\n')) {
          diffParts.push(`+${line}`);
        }
      }

      // Context after
      for (let i = match.endLine + 1; i <= endContext; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }
    }

    return diffParts.join('\n');
  }

  private applyEdits(
    fileContent: string,
    matches: EditMatch[],
    edits: FilesApplyChangesToolEditSchemaType[],
  ): string {
    const lines = fileContent.split('\n');

    // Sort matches by startLine in descending order to apply from bottom to top
    // This prevents line number shifts from affecting subsequent edits
    const sortedMatches = [...matches].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const match of sortedMatches) {
      const edit = edits[match.editIndex];
      if (!edit || edit.newText === undefined) continue;

      const newTextWithIndent = this.applyIndentation(
        edit.newText,
        match.indentation,
      );
      const newLines = newTextWithIndent.split('\n');

      // Replace lines from startLine to endLine with new lines
      lines.splice(
        match.startLine,
        match.endLine - match.startLine + 1,
        ...newLines,
      );
    }

    return lines.join('\n');
  }

  public async invoke(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // Special case: if all edits have empty oldText, we're creating a new file
    const isNewFile = args.edits.every((edit) => edit.oldText === '');

    if (isNewFile && args.edits.length === 1) {
      // Creating new file
      const firstEdit = args.edits[0];
      if (!firstEdit) {
        return {
          output: {
            success: false,
            error: 'No edits provided',
          },
          messageMetadata,
        };
      }
      const newContent = firstEdit.newText;

      if (args.dryRun) {
        return {
          output: {
            success: true,
            appliedEdits: 0,
            totalEdits: 1,
            diff: `New file:\n+${newContent.split('\n').join('\n+')}`,
          },
          messageMetadata,
        };
      }

      // Use base64 encoding to safely handle special characters
      const parentDir = dirname(args.path);
      const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');
      const tempFile = `${args.path}.tmp.${Date.now()}`;
      const cmd = `mkdir -p "${parentDir}" && echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${args.path}"`;

      const writeResult = await this.execCommand(
        {
          cmd,
        },
        config,
        cfg,
      );

      if (writeResult.exitCode !== 0) {
        return {
          output: {
            success: false,
            error: writeResult.stderr || 'Failed to create file',
          },
          messageMetadata,
        };
      }

      return {
        output: {
          success: true,
          appliedEdits: 1,
          totalEdits: 1,
        },
        messageMetadata,
      };
    }

    // Read the file
    const readResult = await this.execCommand(
      { cmd: `cat "${args.path}"` },
      config,
      cfg,
    );

    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: readResult.stderr || 'Failed to read file',
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;

    // Find all matches
    const { matches, errors } = this.findMatches(fileContent, args.edits);

    if (errors.length > 0) {
      return {
        output: {
          success: false,
          error: errors.join(' '),
        },
        messageMetadata,
      };
    }

    // Generate diff
    const originalLines = fileContent.split('\n');
    const diff = this.generateDiff(originalLines, matches, args.edits);

    // If dry run, return diff without applying
    if (args.dryRun) {
      return {
        output: {
          success: true,
          appliedEdits: 0,
          totalEdits: args.edits.length,
          diff,
        },
        messageMetadata,
      };
    }

    // Apply edits
    const modifiedContent = this.applyEdits(fileContent, matches, args.edits);

    // Write modified content back to file using base64 encoding
    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.path}.tmp.${Date.now()}`;
    const cmd = `echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${args.path}"`;

    const writeResult = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (writeResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: writeResult.stderr || 'Failed to write file',
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        appliedEdits: matches.length,
        totalEdits: args.edits.length,
      },
      messageMetadata,
    };
  }
}
