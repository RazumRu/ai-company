import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { GhBaseTool, GhBaseToolConfig } from './gh-base.tool';

export enum SemanticCommitType {
  FEAT = 'feat',
  FIX = 'fix',
  DOCS = 'docs',
  STYLE = 'style',
  REFACTOR = 'refactor',
  PERF = 'perf',
  TEST = 'test',
  CHORE = 'chore',
  BUILD = 'build',
  CI = 'ci',
  REVERT = 'revert',
}

export const GhCommitToolSchema = z.object({
  semanticType: z.enum(SemanticCommitType).describe('Semantic commit type'),
  title: z.string().min(1).describe('Commit title'),
  body: z.string().optional().describe('Optional commit body'),
  path: z.string().describe('Path to the git repository'),
});

export type GhCommitToolSchemaType = z.infer<typeof GhCommitToolSchema>;

type GhCommitToolOutput = {
  error?: string;
  success?: boolean;
  commitHash?: string;
};

@Injectable()
export class GhCommitTool extends GhBaseTool<GhCommitToolSchemaType> {
  public name = 'gh_commit';
  public description =
    'Create a git (GitHub) commit locally with a semantic commit message.';

  protected override generateTitle(
    args: GhCommitToolSchemaType,
    _config: GhBaseToolConfig,
  ): string {
    return `Committing (${args.semanticType}) ${args.title}`;
  }

  public getDetailedInstructions(
    _config: GhBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Creates git commit with semantic format: "{semanticType}: [AI] {title}". Requires staged changes first.

      ### When to Use
      After staging changes with git add. For semantic commits with atomic changes.

      ### When NOT to Use
      No changes staged → use shell with git add first. Custom format needed → use shell with git commit -m. Just pushing → use gh_push.

      ### Prerequisites
      **Must stage changes first!** Use shell: \`git add .\` or \`git add src/file.ts\`

      ### Best Practices
      Write meaningful titles: "add user auth endpoint" (good) vs "fix bug" (too vague). Use body for context when needed. Make atomic commits (related changes together).

      ### Examples
      **1. Simple commit:**
      \`\`\`json
      {"semanticType": "feat", "title": "add search filters", "path": "/repo"}
      \`\`\`

      **2. With body:**
      \`\`\`json
      {"semanticType": "refactor", "title": "extract validation logic", "body": "Reduces duplication\\n- Created validation/ dir\\n- Updated imports", "path": "/repo"}
      \`\`\`

      **3. After cd into repo:**
      \`\`\`json
      {"semanticType": "fix", "title": "prevent duplicate submissions"}
      \`\`\`

      Example:
      \`\`\`
      feat: [AI] add user registration endpoint

      Implements user registration with email verification.
      - Adds POST /api/users/register
      - Sends verification email
      - Adds registration form validation
      \`\`\`

      ### Troubleshooting
      - "No staged changes" → Stage files with \`git add\` first
      - "Not a git repository" → Ensure path points to a git repo
      - Commit appears empty → Check if changes were actually made
    `;
  }

  public get schema() {
    return GhCommitToolSchema;
  }

  private buildCommand(cmd: string, path?: string): string {
    if (path) {
      const p = JSON.stringify(path);
      return `cd ${p} && ${cmd}`;
    }
    return cmd;
  }

  public async invoke(
    args: GhCommitToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCommitToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const commitMessage = `${args.semanticType}: [AI] ${args.title}`;

    // Use git commit command
    // First, check if there are staged changes
    const diffRes = await this.execGhCommand(
      {
        cmd: this.buildCommand('git diff --cached --quiet', args.path),
      },
      config,
      cfg,
    );

    // git diff --cached --quiet returns 0 if there are no staged changes, 1 if there are staged changes
    if (diffRes.exitCode === 0) {
      // No staged changes
      return {
        output: {
          error:
            'No staged changes to commit. Please stage your changes first using `git add`.',
          success: false,
        },
        messageMetadata,
      };
    }

    // Create commit with message
    // Use multiple -m flags for multi-line messages (title and body)
    const commitCmd = args.body
      ? `git commit -m ${JSON.stringify(commitMessage)} -m ${JSON.stringify(args.body)}`
      : `git commit -m ${JSON.stringify(commitMessage)}`;

    const commitRes = await this.execGhCommand(
      {
        cmd: this.buildCommand(commitCmd, args.path),
      },
      config,
      cfg,
    );

    if (commitRes.exitCode !== 0) {
      return {
        output: {
          error:
            commitRes.stderr || commitRes.stdout || 'Failed to create commit',
          success: false,
        },
        messageMetadata,
      };
    }

    // Get the commit hash
    const hashRes = await this.execGhCommand(
      {
        cmd: this.buildCommand('git rev-parse HEAD', args.path),
      },
      config,
      cfg,
    );

    const commitHash =
      hashRes.exitCode === 0 ? hashRes.stdout.trim() : undefined;

    return {
      output: {
        success: true,
        commitHash,
      },
      messageMetadata,
    };
  }
}
