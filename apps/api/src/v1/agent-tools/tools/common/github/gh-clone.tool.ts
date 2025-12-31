import path from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
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
    'Clone a GitHub repository into the running container using authenticated HTTPS. Optionally specify a branch or tag to checkout, and a depth for shallow cloning. Returns the path to the cloned repository.';

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
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Clones a GitHub repository into the runtime environment using authenticated HTTPS via the GitHub CLI (gh). Authentication is handled automatically via configured PAT token.

      ### When to Use
      - Setting up a new project to work on
      - Getting access to a repository's code
      - Starting work on a specific branch or tag
      - Creating a working copy for modifications

      ### When NOT to Use
      - Repository is already cloned → navigate to existing clone
      - Just need to view a file → consider GitHub API or web interface first
      - Repository requires special credentials not configured

      ${parameterDocs}

      ### Best Practices

      **1. Use shallow clones for large repositories:**
      \`\`\`json
      {"owner": "chromium", "repo": "chromium", "depth": 1}
      \`\`\`

      **2. Clone specific branches when needed:**
      \`\`\`json
      {"owner": "owner", "repo": "project", "branch": "main"}
      \`\`\`

      **3. Remember the cloned path for subsequent operations:**
      The output includes the path - use this for all file and git operations.

      ### Output Format
      Success:
      \`\`\`json
      {
        "path": "/workspace/project-name"
      }
      \`\`\`

      Error:
      \`\`\`json
      {
        "error": "Could not resolve to a Repository with the name 'owner/repo'."
      }
      \`\`\`

      ### After Cloning
      1. Use the returned path for all subsequent operations
      2. Run \`files_list\` to explore the repository structure
      3. Build tags index if working with a large codebase
      4. Use git commands via shell tool for further git operations

      ### Common Patterns

      **Clone and explore:**
      \`\`\`
      1. gh_clone → get path
      2. files_list with returned path → see structure
      3. files_read → examine key files
      \`\`\`

      **Clone for making changes:**
      \`\`\`
      1. gh_clone → get working copy
      2. gh_branch → create feature branch
      3. Make changes with files_apply_changes
      4. gh_commit → commit changes
      5. gh_push → push to remote
      \`\`\`

      ### Authentication Notes
      - Uses configured GitHub PAT token automatically
      - Token must have appropriate repository access
      - Private repositories require token with repo scope

      ### Troubleshooting
      - "Not found" → Check owner/repo spelling, verify access permissions
      - Slow clone → Use depth parameter for faster shallow clone
      - Authentication error → Verify PAT token is configured correctly
    `;
  }

  public get schema() {
    return z.toJSONSchema(GhCloneToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: GhCloneToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCloneToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const cmd = [`gh repo clone ${args.owner}/${args.repo}`];

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

    return {
      output: {
        path: path.join(res.execPath || '', args.repo),
      },
      messageMetadata,
    };
  }
}
