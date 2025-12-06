import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
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
    'Create a git (GitHub) commit locally with a semantic commit message. The commit message will be formatted as "{semanticType}: [AI] {title}" with an optional body. Use gh_push tool to push commits to the remote repository.';

  public getDetailedInstructions(
    config: GhBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Creates a git commit with a standardized semantic commit message format. The commit message is automatically formatted as "{semanticType}: [AI] {title}" with an optional body for detailed description.

      ### When to Use
      - After staging changes with \`git add\`
      - When you have modifications ready to be committed
      - Following semantic commit conventions
      - Creating atomic commits for specific changes

      ### When NOT to Use
      - No changes are staged → use shell with \`git add\` first
      - You need a custom commit message format → use shell with \`git commit -m\`
      - Just want to push → use \`gh_push\` (commits must exist first)

      ### Prerequisites
      **Changes must be staged before committing!**
      \`\`\`bash
      # Stage all changes
      git add .

      # Or stage specific files
      git add src/file1.ts src/file2.ts

      # Or stage by pattern
      git add "*.ts"
      \`\`\`

      ${parameterDocs}

      **Good titles:**
      - "add user registration endpoint"
      - "fix null pointer in parser"
      - "update README with setup instructions"

      **Avoid:**
      - "fix bug" (too vague)
      - "update code" (not descriptive)
      - "WIP" (incomplete work)

      ### Best Practices

      **1. Stage before committing:**
      Use shell tool to stage changes:
      \`\`\`bash
      cd /repo && git add -A
      \`\`\`

      **2. Make atomic commits:**
      Commit related changes together, unrelated changes separately.

      **3. Write meaningful titles:**
      \`\`\`json
      // Good
      {"semanticType": "fix", "title": "prevent duplicate form submissions", "path": "/repo"}

      // Bad
      {"semanticType": "fix", "title": "fix issue", "path": "/repo"}
      \`\`\`

      **Current directory example (after shell cd /repo and staging):**
      \`\`\`json
      {"semanticType": "feat", "title": "add search filters"}
      \`\`\`

      **4. Use body for context:**
      \`\`\`json
      {
        "semanticType": "refactor",
        "title": "extract validation into separate module",
        "body": "Motivation: Reduce code duplication across controllers.\\nChanges:\\n- Created validation/ directory\\n- Moved all validators\\n- Updated imports",
        "path": "/repo"
      }
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
      {
        "success": true,
        "commitHash": "a1b2c3d4e5f6789..."
      }
      \`\`\`

      Error (no staged changes):
      \`\`\`json
      {
        "success": false,
        "error": "No staged changes to commit. Please stage your changes first using \`git add\`."
      }
      \`\`\`

      ### Common Workflow
      \`\`\`
      1. Make changes with files_apply_changes
      2. Stage changes: shell with "git add -A" or specific files
      3. gh_commit → Create commit
      4. gh_push → Push to remote
      \`\`\`

      ### Commit Message Format
      The final message format is:
      \`\`\`
      {semanticType}: [AI] {title}

      {body if provided}
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
  ): Promise<GhCommitToolOutput> {
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
        error:
          'No staged changes to commit. Please stage your changes first using `git add`.',
        success: false,
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
        error:
          commitRes.stderr || commitRes.stdout || 'Failed to create commit',
        success: false,
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
      success: true,
      commitHash,
    };
  }
}
