import path from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { GhBaseTool, GhBaseToolConfig, GhBaseToolSchema } from './gh-base.tool';

export const GhCloneToolSchema = GhBaseToolSchema.extend({
  branch: z
    .string()
    .nullable()
    .optional()
    .describe('Optional branch or tag to checkout.'),
  depth: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe('Shallow clone depth (omit for full clone).'),
  workdir: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Optional working directory path where the repository should be cloned. If not provided, clones to the default location.',
    ),
});

export type GhCloneToolSchemaType = z.infer<typeof GhCloneToolSchema>;

type GhCloneToolOutput = {
  error?: string;
  path?: string;
};

@Injectable()
export class GhCloneTool extends GhBaseTool<GhCloneToolSchemaType> {
  public name = 'gh_clone';
  public description =
    'Clone a GitHub repository into the running container using authenticated HTTPS.';

  protected override generateTitle(
    args: GhCloneToolSchemaType,
    _config: GhBaseToolConfig,
  ): string {
    const suffix = args.branch ? `@${args.branch}` : '';
    return `Cloning ${args.owner}/${args.repo}${suffix}`;
  }

  public getDetailedInstructions(
    _config: GhBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Clones GitHub repository using authenticated HTTPS via gh CLI. Returns path for subsequent operations.

      ### When to Use
      Setting up new project to work on, getting repo code, starting work on specific branch.

      ### When NOT to Use
      Repo already cloned → navigate to existing. Just viewing file → use GitHub API/web. Special credentials needed → configure first.

      ### Examples
      **1. Shallow clone (large repos):**
      \`\`\`json
      {"owner": "chromium", "repo": "chromium", "depth": 1}
      \`\`\`

      **2. Specific branch:**
      \`\`\`json
      {"owner": "facebook", "repo": "react", "branch": "main"}
      \`\`\`

      **3. Custom location:**
      \`\`\`json
      {"owner": "user", "repo": "project", "workdir": "/custom/path/project"}
      \`\`\`

      ### After Cloning
      Use returned path for all operations. Run files_find_paths to explore structure. Use shell for git commands.
    `;
  }

  public get schema() {
    return zodToAjvSchema(GhCloneToolSchema);
  }

  public async invoke(
    args: GhCloneToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCloneToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const cmd = [`gh repo clone ${args.owner}/${args.repo}`];

    // Add workdir if specified
    if (args.workdir) {
      cmd.push(args.workdir);
    }

    if (args.branch || args.depth) {
      cmd.push('--');
    }

    if (args.branch) {
      cmd.push(`--branch ${args.branch}`);
    }

    if (args.depth) {
      cmd.push(`--depth ${args.depth}`);
    }

    const res = await this.execGhCommand(
      {
        cmd: cmd.join(' '),
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to clone repository',
        },
        messageMetadata,
      };
    }

    // Determine the clone path: use workdir if provided, otherwise default to execPath/repo
    const clonePath = args.workdir
      ? args.workdir
      : path.join(res.execPath || '', args.repo);

    return {
      output: {
        path: clonePath,
      },
      messageMetadata,
    };
  }
}
