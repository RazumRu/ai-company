import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesSearchTagsToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .describe(
      'The directory path to search in. Use absolute paths. Same directory that was used when building the tags.',
    ),
  alias: z
    .string()
    .min(1)
    .describe('The alias used when building the tags index.'),
  query: z
    .string()
    .min(1)
    .describe(
      'The symbol name or regex pattern to search for. If it contains regex special characters, it will be treated as a regex pattern.',
    ),
  exactMatch: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If true, performs exact name matching. If false, treats query as a regex pattern.',
    ),
});

export type FilesSearchTagsToolSchemaType = z.infer<
  typeof FilesSearchTagsToolSchema
>;

type FilesSearchTagsToolOutput = {
  error?: string;
  matches?: unknown[];
};

@Injectable()
export class FilesSearchTagsTool extends FilesBaseTool<FilesSearchTagsToolSchemaType> {
  public name = 'files_search_tags';
  public description =
    'Search for symbols in a ctags index file. Supports both exact name matching and regex pattern matching. Returns matching tag entries as JSON.';

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Searches a previously built ctags index for symbol definitions. Faster and more precise than text search for finding function, class, and variable definitions. Requires prior \`files_build_tags\` call.

      ### When to Use
      - Finding where a function or class is defined
      - Looking up all methods in a class
      - Finding variable and constant definitions
      - Navigating to symbol definitions in large codebases

      ### When NOT to Use
      - Tags index hasn't been built → call \`files_build_tags\` first
      - Searching for text content (not symbols) → use \`files_search_text\`
      - Finding usages of a symbol → use \`files_search_text\`
      - Looking for comments or strings → use \`files_search_text\`

      ${parameterDocs}

      ### Best Practices

      **1. Use exact match for known symbols:**
      \`\`\`json
        {"dir": "/repo", "alias": "project", "query": "UserController", "exactMatch": true}
      \`\`\`

      **2. Use regex for pattern discovery:**
      \`\`\`json
        // Find all hooks
        {"dir": "/repo", "alias": "project", "query": "^use[A-Z]"}

        // Find all test functions
        {"dir": "/repo", "alias": "project", "query": "^test.*|^it.*|^describe.*"}

        // Find all handlers
        {"dir": "/repo", "alias": "project", "query": "handle[A-Z]"}
      \`\`\`

      **3. Narrow searches with specific patterns:**
      \`\`\`json
        // Instead of broad search
        {"dir": "/repo", "alias": "project", "query": "User"}

        // Be specific
        {"dir": "/repo", "alias": "project", "query": "UserService", "exactMatch": true}
      \`\`\`

      ### Output Format
      Returns matching tag entries:
      \`\`\`json
        {
          "matches": [
            {
              "name": "UserService",
              "path": "/repo/src/services/user.service.ts",
              "line": 15,
              "kind": "class",
              "scope": null
            },
            {
              "name": "getUserById",
              "path": "/repo/src/services/user.service.ts",
              "line": 25,
              "kind": "method",
              "scope": "UserService"
            }
          ]
        }
      \`\`\`

      ### Tag Entry Fields
      | Field | Description |
      |-------|-------------|
      | name | Symbol name |
      | path | File path where symbol is defined |
      | line | Line number of definition |
      | kind | Symbol type (function, class, method, variable, etc.) |
      | scope | Parent scope (e.g., class name for methods) |

      ### Common Patterns

      **Find class definition:**
      \`\`\`json
        {"dir": "/repo", "alias": "project", "query": "AuthService", "exactMatch": true}
      \`\`\`

      **Find all classes:**
      \`\`\`json
        {"dir": "/repo", "alias": "project", "query": "Service$"}  // Classes ending in Service
      \`\`\`

      **Find React components:**
      \`\`\`json
        {"dir": "/repo", "alias": "project", "query": "^[A-Z][a-z].*Component$"}
      \`\`\`

      ### After Finding Definitions
      1. Get the file path and line number from results
      2. Use \`files_read\` with startLine/endLine to view the full implementation
      3. Use \`files_search_text\` to find all usages of the symbol

      ### Troubleshooting
      - "No matches" → Verify alias is correct, tags are built
      - Wrong results → Check if tags need to be rebuilt after code changes
      - Symbol not found → May not be indexed (check language support)
    `;
  }

  public get schema() {
    return FilesSearchTagsToolSchema;
  }

  public async invoke(
    args: FilesSearchTagsToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesSearchTagsToolOutput> {
    const threadId =
      cfg.configurable?.parent_thread_id ||
      cfg.configurable?.thread_id ||
      'unknown';

    const tagsFile = `/tmp/${threadId.replace(/:/g, '_')}/${args.alias}.json`;

    let cmd: string;
    if (args.exactMatch) {
      // Exact match: select(.name == "SYMBOL_NAME")
      const escapedQuery = args.query.replace(/"/g, '\\"');
      cmd = `cd "${args.dir}" && jq -c 'select(.name == "${escapedQuery}")' "${tagsFile}"`;
    } else {
      // Regex match: select(.name | test("SYMBOL_REGEX"))
      const escapedQuery = args.query.replace(/"/g, '\\"');
      cmd = `cd "${args.dir}" && jq -c 'select(.name | test("${escapedQuery}"))' "${tagsFile}"`;
    }

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      // jq returns exit code 1 when no matches are found, which is not an error
      if (res.exitCode === 1 && !res.stderr) {
        return {
          matches: [],
        };
      }

      return {
        error: res.stderr || res.stdout || 'Failed to search tags',
      };
    }

    // Parse JSON lines output from jq
    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: unknown[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        matches.push(parsed);
      } catch (e) {
        // Skip invalid JSON lines
        continue;
      }
    }

    return {
      matches,
    };
  }
}
