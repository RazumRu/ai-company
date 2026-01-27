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

export const FilesSearchTagsToolSchema = z.object({
  directoryPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to search. If omitted, uses the current working directory of the persistent shell session. Should match the directory used when building the tags.',
    ),
  symbolQuery: z
    .string()
    .min(1)
    .describe(
      'The symbol name or regex pattern to search for. If it contains regex special characters, it will be treated as a regex pattern.',
    ),
  exactMatch: z
    .boolean()
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
    'Search symbol definitions in a previously built ctags index (names only).';

  protected override generateTitle(
    args: FilesSearchTagsToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const matchType = args.exactMatch ? 'exact' : 'regex';
    const location = args.directoryPath ?? 'current directory';
    return `Tag search (${matchType}) "${args.symbolQuery}" in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Search symbol definitions in a prebuilt ctags index. Requires \`files_build_tags\` first.

      ### When to Use
      - Finding where a class/function is defined
      - Jumping to symbol definitions quickly
      - Listing methods by pattern (regex)

      ### When NOT to Use
      - Tags not built or stale -> rebuild first
      - Text or usage search -> \`files_search_text\`

      ### Best Practices
      - exactMatch=true for a known symbol name.
      - regex (default) for pattern discovery.
      - After results, read the file with \`files_read\` and a small range.
      - Rebuild tags after file changes.

      ### Examples
      **1) Exact match:**
      \`\`\`json
      {"directoryPath":"/repo","symbolQuery":"UserService","exactMatch":true}
      \`\`\`

      **2) Regex search (all Services):**
      \`\`\`json
      {"directoryPath":"/repo","symbolQuery":"Service$"}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesSearchTagsToolSchema;
  }

  public async invoke(
    args: FilesSearchTagsToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesSearchTagsToolOutput>> {
    const maxResults = 15;
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };
    const threadId =
      cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
    if (!threadId) {
      return {
        output: {
          error: 'Thread id is required to search tags',
        },
        messageMetadata,
      };
    }

    const tagsFile = `/tmp/${threadId.replace(/:/g, '_')}/tags.json`;

    let cmd: string;
    if (args.exactMatch) {
      // Exact match: select(.name == "SYMBOL_NAME")
      const escapedQuery = args.symbolQuery.replace(/"/g, '\\"');
      const prefix = args.directoryPath ? `cd "${args.directoryPath}" && ` : '';
      cmd = `${prefix}jq -c 'select(.name == "${escapedQuery}")' "${tagsFile}"`;
    } else {
      // Regex match: select(.name | test("SYMBOL_REGEX"))
      const escapedQuery = args.symbolQuery.replace(/"/g, '\\"');
      const prefix = args.directoryPath ? `cd "${args.directoryPath}" && ` : '';
      cmd = `${prefix}jq -c 'select(.name | test("${escapedQuery}"))' "${tagsFile}"`;
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
          output: {
            matches: [],
          },
          messageMetadata,
        };
      }

      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to search tags',
        },
        messageMetadata,
      };
    }

    // Parse JSON lines output from jq
    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: unknown[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        matches.push(parsed);
        if (matches.length >= maxResults) {
          break;
        }
      } catch (_e) {
        // Skip invalid JSON lines
        continue;
      }
    }

    return {
      output: {
        matches,
      },
      messageMetadata,
    };
  }
}
