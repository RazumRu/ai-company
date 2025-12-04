import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesSearchTextToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .describe('Path to the repository directory to search in.'),
  query: z
    .string()
    .min(1)
    .describe('The text pattern to search for (regex supported by ripgrep).'),
  filePath: z
    .string()
    .optional()
    .describe(
      'Optional absolute file path to search in. If provided, searches only in this specific file. Can be used directly with paths returned from files_list.',
    ),
  includeGlobs: z
    .array(z.string())
    .optional()
    .describe(
      'Optional array of glob patterns to include (e.g., ["*.ts", "src/**"]).',
    ),
  excludeGlobs: z
    .array(z.string())
    .optional()
    .describe(
      'Optional array of glob patterns to exclude (e.g., ["*.test.ts", "node_modules/**"]).',
    ),
});

export type FilesSearchTextToolSchemaType = z.infer<
  typeof FilesSearchTextToolSchema
>;

type FilesSearchTextToolOutput = {
  error?: string;
  matches?: {
    type: string;
    data: {
      path?: {
        text: string;
      };
      lines?: {
        text: string;
      };
      line_number?: number;
      absolute_offset?: number;
      submatches?: {
        match: {
          text: string;
        };
        start: number;
        end: number;
      }[];
    };
  }[];
};

@Injectable()
export class FilesSearchTextTool extends FilesBaseTool<FilesSearchTextToolSchemaType> {
  public name = 'files_search_text';
  public description =
    'Search for text patterns in repository files using ripgrep (rg). Supports regex patterns, file filtering with globs, and searching in specific files. The filePath parameter expects an absolute path (can be used directly with paths returned from files_list). Returns JSON-formatted search results with file paths, line numbers, and matched text.';

  public get schema() {
    return FilesSearchTextToolSchema;
  }

  public async invoke(
    args: FilesSearchTextToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesSearchTextToolOutput> {
    const cmdParts: string[] = ['rg', '--json'];

    // If filePath is provided, use absolute path directly (no need to cd)
    if (args.filePath) {
      cmdParts.push(`"${args.query}"`, `"${args.filePath}"`);
    } else {
      // When searching across directory, cd to the directory first
      cmdParts.unshift(`cd "${args.dir}"`, '&&');
      // Add hidden flag when searching across files
      cmdParts.push('--hidden');

      // Add include globs
      if (args.includeGlobs && args.includeGlobs.length > 0) {
        for (const glob of args.includeGlobs) {
          cmdParts.push('--glob', `'${glob}'`);
        }
      }

      // Add exclude globs
      if (args.excludeGlobs && args.excludeGlobs.length > 0) {
        for (const glob of args.excludeGlobs) {
          cmdParts.push('--glob', `'!${glob}'`);
        }
      } else {
        // Default: exclude .git directory
        cmdParts.push('--glob', "'!.git'");
      }

      // Add query
      cmdParts.push(`"${args.query}"`);
    }

    const cmd = cmdParts.join(' ');

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      // ripgrep returns exit code 1 when no matches are found, which is not an error
      if (res.exitCode === 1 && !res.stderr) {
        return {
          matches: [],
        };
      }

      return {
        error: res.stderr || res.stdout || 'Failed to search text',
      };
    }

    // Parse JSON lines output from ripgrep
    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: FilesSearchTextToolOutput['matches'] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          matches.push(parsed);
        }
      } catch (e) {
        // Skip invalid JSON lines (like summary lines)
        continue;
      }
    }

    return {
      matches,
    };
  }
}
