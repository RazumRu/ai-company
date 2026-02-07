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
    .describe(
      'Absolute path to the directory to scan.',
    ),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum directory depth to traverse. Start with 3-5 for large repos and increase if needed. Omit for unlimited depth (not recommended for large projects).',
    ),
  skipPatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Glob patterns to exclude from the tree (fd syntax, e.g., ["node_modules/**", "dist/**"]). Defaults to excluding node_modules, dist, build, coverage, and .turbo if not specified.',
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
    'Generate a visual tree representation of a directory structure showing files and subdirectories. Start with a shallow maxDepth (3-5) for large repositories. Common build/cache directories are excluded by default. Does not return file contents — use files_read for that.';

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
      Visual tree view of a directory structure, similar to the Unix \`tree\` command. Outputs an indented text representation of files and subdirectories.

      ### When to Use
      - Orienting yourself in a new or unfamiliar repository
      - Understanding the project layout before making changes
      - Verifying directory structure after scaffolding or refactoring
      - Finding where files are organized (e.g., "where are the tests?")

      ### When NOT to Use
      - Reading file contents → use \`files_read\`
      - Searching for text in files → use \`files_search_text\`
      - Finding files by name → use \`files_find_paths\`

      ### Best Practices
      - **Start shallow**: use maxDepth 3-5 for initial exploration of large repos
      - **Narrow down**: once you identify the relevant subdirectory, run again on that path with deeper maxDepth
      - **Use skipPatterns** to exclude noisy directories specific to the project
      - Default exclusions: node_modules, dist, build, coverage, .turbo — override with skipPatterns if needed

      ### Examples
      **1. Explore project root (shallow):**
      \`\`\`json
      {"directoryPath": "/runtime-workspace/project", "maxDepth": 3}
      \`\`\`

      **2. Deep dive into specific directory:**
      \`\`\`json
      {"directoryPath": "/runtime-workspace/project/src/modules/auth", "maxDepth": 5}
      \`\`\`

      **3. Custom exclusions:**
      \`\`\`json
      {"directoryPath": "/runtime-workspace/project", "maxDepth": 4, "skipPatterns": ["node_modules/**", "**/*.test.ts"]}
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
