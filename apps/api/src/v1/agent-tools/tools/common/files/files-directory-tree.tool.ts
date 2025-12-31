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
    'Generate a tree view of a directory (files + folders). Useful for getting an overview of project structure before searching/editing.';

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
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Produces a recursive tree view (files + folders) for a directory. Use this to understand structure before searching/editing.

      ${parameterDocs}

      ### When to Use
      - Getting a quick overview of an unfamiliar repository
      - Finding “where things live” before using \`files_search_text\`
      - Verifying generated files landed in the directory you expected

      ### When NOT to Use
      - You want “find files by glob” → use \`files_search_files\`
      - You want “search content inside files” → use \`files_search_text\`
      - You only need a couple of known files → just \`files_read\`

      ### Best Practices
      - Always exclude huge folders (deps/build outputs) unless you explicitly need them.
      - Use \`maxDepth\` to avoid producing an enormous tree on big repos.
      - Follow up with \`files_search_files\` or \`files_search_text\` once you know the right subdirectory.

      ### Examples
      **1) Small project overview:**
      \`\`\`json
      { "path": "/repo" }
      \`\`\`

      **2) Large repo overview (recommended defaults + depth cap):**
      \`\`\`json
      {
        "path": "/repo",
        "maxDepth": 4,
        "excludePatterns": ["node_modules/**", "dist/**", "build/**", "coverage/**", ".turbo/**", ".git/**"]
      }
      \`\`\`

      **3) Focus a subdirectory:**
      \`\`\`json
      { "path": "/repo/apps/api", "maxDepth": 6, "excludePatterns": ["node_modules/**", "dist/**"] }
      \`\`\`

      ### Output Format
      \`\`\`text
      repo
      ├── src
      │   ├── index.ts
      │   └── utils.ts
      └── package.json
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
