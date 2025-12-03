import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  FilesBaseTool,
  FilesBaseToolConfig,
  FilesBaseToolSchema,
} from './files-base.tool';

export const FilesSearchTagsToolSchema = FilesBaseToolSchema.extend({
  alias: z
    .string()
    .min(1)
    .describe('Alias/name of the tags index file to search.'),
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

    const tagsFile = `/tmp/${threadId}/${args.alias}.json`;

    let cmd: string;
    if (args.exactMatch) {
      // Exact match: select(.name == "SYMBOL_NAME")
      const escapedQuery = args.query.replace(/"/g, '\\"');
      cmd = `cd "${args.repoDir}" && jq -c 'select(.name == "${escapedQuery}")' "${tagsFile}"`;
    } else {
      // Regex match: select(.name | test("SYMBOL_REGEX"))
      const escapedQuery = args.query.replace(/"/g, '\\"');
      cmd = `cd "${args.repoDir}" && jq -c 'select(.name | test("${escapedQuery}"))' "${tagsFile}"`;
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
