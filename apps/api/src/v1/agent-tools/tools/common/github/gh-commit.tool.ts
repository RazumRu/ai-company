import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
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
  path: z
    .string()
    .optional()
    .describe('Path to the git repository (default: current directory)'),
  push: z
    .boolean()
    .optional()
    .describe(
      'Whether to push the commit to the remote repository after committing',
    ),
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
    'Create a git (GitHub) commit locally with a semantic commit message. The commit message will be formatted as "{semanticType}: [AI] {title}" with an optional body. Optionally push the commit to the remote repository.';

  public get schema() {
    return GhCommitToolSchema;
  }

  private buildCommand(cmd: string, path?: string): string {
    if (path) {
      return `cd ${JSON.stringify(path)} && ${cmd}`;
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

    // Push to remote if requested
    if (args.push === true) {
      const pushRes = await this.execGhCommand(
        {
          cmd: this.buildCommand('git push', args.path),
        },
        config,
        cfg,
      );

      if (pushRes.exitCode !== 0) {
        return {
          success: false,
          error: pushRes.stderr || pushRes.stdout || 'Failed to push commit',
          commitHash,
        };
      }
    }

    return {
      success: true,
      commitHash,
    };
  }
}
