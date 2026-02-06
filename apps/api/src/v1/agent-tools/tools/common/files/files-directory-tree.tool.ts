import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { shQuote } from '../../../../utils/shell.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesDirectoryTreeToolSchema = z.object({
  directoryPath: z
    .string()
    .min(1)
    .describe('Absolute path to the directory to scan.'),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional maximum depth to traverse.'),
  skipPatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional glob patterns to exclude (fd syntax). If omitted, some common junk folders are excluded.',
    ),
});

export type FilesDirectoryTreeToolSchemaType = z.infer<
  typeof FilesDirectoryTreeToolSchema
>;

type FilesDirectoryTreeToolOutput = {
  error?: string;
  tree?: string;
};

type TreeNode = {
  children: Map<string, TreeNode>;
};

const makeNode = (): TreeNode => ({ children: new Map() });

function buildTree(paths: string[]): TreeNode {
  const root = makeNode();

  for (const p of paths) {
    const trimmed = p.replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!trimmed) continue;
    const parts = trimmed.split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      const next = node.children.get(part) ?? makeNode();
      node.children.set(part, next);
      node = next;
    }
  }

  return root;
}

function renderTree(node: TreeNode, prefix = ''): string[] {
  const entries = Array.from(node.children.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, child] = entries[i]!;
    const isLast = i === entries.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${branch}${name}`);
    const nextPrefix = `${prefix}${isLast ? '    ' : '│   '}`;
    lines.push(...renderTree(child, nextPrefix));
  }
  return lines;
}

@Injectable()
export class FilesDirectoryTreeTool extends FilesBaseTool<FilesDirectoryTreeToolSchemaType> {
  public name = 'files_directory_tree';
  public description =
    'Generate a tree overview of a directory (structure; not content search).';

  protected override generateTitle(
    args: FilesDirectoryTreeToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const dirName = basename(args.directoryPath) || 'root';
    return `Tree view: ${dirName}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Tree view of a directory (structure only).

      ### When to Use
      Quick overview before searching/reading.

      ### When NOT to Use
      - Finding specific paths -> \`files_find_paths\`
      - Searching content -> \`files_search_text\`

      ### Best Practices
      - Start shallow (maxDepth 3-5).
      - Add skipPatterns for build/cache dirs.
      - Narrow to a subdirectory when possible.

      ### Examples
      **1) Repo overview:**
      \`\`\`json
      {"directoryPath":"/repo","maxDepth":4}
      \`\`\`

      **2) Subfolder with exclusions:**
      \`\`\`json
      {"directoryPath":"/repo/apps/api","maxDepth":6,"skipPatterns":["node_modules/**","dist/**","build/**"]}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesDirectoryTreeToolSchema;
  }

  public async invoke(
    args: FilesDirectoryTreeToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesDirectoryTreeToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const skipPatterns =
      args.skipPatterns && args.skipPatterns.length > 0
        ? args.skipPatterns
        : [
            'node_modules/**',
            'dist/**',
            'build/**',
            'coverage/**',
            '.turbo/**',
          ];

    const cmdParts: string[] = [
      'fd',
      '--hidden',
      '--type',
      'f',
      '--type',
      'd',
      '--exclude',
      '.git',
    ];

    if (args.maxDepth !== undefined) {
      cmdParts.push('--max-depth', String(args.maxDepth));
    }

    for (const ex of skipPatterns) {
      cmdParts.push('--exclude', shQuote(ex));
    }

    cmdParts.push('--color', 'never', '.');

    const baseCmd = cmdParts.join(' ');
    const cmd = `cd ${shQuote(args.directoryPath)} && ${baseCmd}`;

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return {
        output: { error: res.stderr || res.stdout || 'Failed to build tree' },
        messageMetadata,
      };
    }

    const relPaths = res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const rootLabel =
      basename(args.directoryPath.replace(/\/+$/, '')) || args.directoryPath;
    const root = buildTree(relPaths);
    const lines = [rootLabel, ...renderTree(root)];

    return {
      output: { tree: lines.join('\n') },
      messageMetadata,
    };
  }
}
