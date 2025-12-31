import { basename } from 'node:path';

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

export const FilesDirectoryTreeToolSchema = z.object({
  path: z.string().min(1).describe('Absolute path to a directory to scan.'),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional maximum depth to traverse.'),
  excludePatterns: z
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

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
    const dirName = basename(args.path) || 'root';
    return `Tree view: ${dirName}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Generates a readable directory tree (structure only; not a content search). Uses \`fd\` to enumerate files/dirs and renders a compact tree string.

      ### When to Use
      - Getting a quick “what’s in here?” overview before deciding what to read/search
      - Sharing a lightweight structure snapshot (especially with \`maxDepth\`)
      - Understanding monorepo/package layout at a glance

      ### When NOT to Use
      - You need exact paths matching a glob → use \`files_find_paths\`
      - You need to search file contents → use \`files_search_text\`

      ### Best Practices
      - Start with a shallow \`maxDepth\` (e.g. 3–5) and increase only if needed.
      - Add \`excludePatterns\` to avoid huge folders (build outputs, dependencies, caches).

      ### Examples
      **1) Repo overview (shallow):**
      \`\`\`json
      {"path":"/repo","maxDepth":4}
      \`\`\`

      **2) Deeper tree for a subfolder while excluding junk:**
      \`\`\`json
      {"path":"/repo/apps/api","maxDepth":6,"excludePatterns":["node_modules/**","dist/**","build/**","coverage/**"]}
      \`\`\`

      ### Output Format
      \`\`\`json
      { "tree": "repo\n├── apps\n│   └── api\n└── packages\n" }
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesDirectoryTreeToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: FilesDirectoryTreeToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesDirectoryTreeToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const excludePatterns =
      args.excludePatterns && args.excludePatterns.length > 0
        ? args.excludePatterns
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

    for (const ex of excludePatterns) {
      cmdParts.push('--exclude', shQuote(ex));
    }

    cmdParts.push('--color', 'never', '.');

    const baseCmd = cmdParts.join(' ');
    const cmd = `cd ${shQuote(args.path)} && ${baseCmd}`;

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

    const rootLabel = basename(args.path.replace(/\/+$/, '')) || args.path;
    const root = buildTree(relPaths);
    const lines = [rootLabel, ...renderTree(root)];

    return {
      output: { tree: lines.join('\n') },
      messageMetadata,
    };
  }
}
