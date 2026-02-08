import path from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { GitRepositoriesDao } from '../../../../git-repositories/dao/git-repositories.dao';
import { GitRepositoryProvider } from '../../../../git-repositories/git-repositories.types';
import { GitRepositoriesService } from '../../../../git-repositories/services/git-repositories.service';
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
    .describe(
      'Branch name or tag to checkout after cloning (e.g., "main", "v2.0.0"). Omit to use the repository default branch.',
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe(
      'Shallow clone depth — only fetch the last N commits. Use depth=1 for large repos when full history is not needed. Omit for a full clone with complete history.',
    ),
  workdir: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Custom absolute path where the repository should be cloned (e.g., "/runtime-workspace/my-project"). If not provided, clones to the default runtime workspace location.',
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
    'Clone a GitHub repository into the runtime container using authenticated HTTPS. Returns the absolute path where the repository was cloned, which should be used for all subsequent file and git operations. Supports optional branch/tag checkout, shallow cloning (depth), and custom clone destinations (workdir). If the repository is already cloned, navigate to the existing path instead of re-cloning.';

  constructor(
    private readonly gitRepositoriesDao: GitRepositoriesDao,
    private readonly gitRepositoriesService: GitRepositoriesService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

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
      Clones a GitHub repository using authenticated HTTPS. Returns the clone path for subsequent operations.

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
    return GhCloneToolSchema;
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

    // Track the cloned repository with GitHub token
    const userId = cfg.configurable?.graph_created_by as string | undefined;
    if (userId) {
      await this.upsertGitRepository(args, userId, config.patToken);
    }

    return {
      output: {
        path: clonePath,
      },
      messageMetadata,
    };
  }

  private async upsertGitRepository(
    args: GhCloneToolSchemaType,
    userId: string,
    patToken: string,
  ): Promise<void> {
    try {
      const existing = await this.gitRepositoriesDao.getOne({
        owner: args.owner,
        repo: args.repo,
        provider: GitRepositoryProvider.GITHUB,
        createdBy: userId,
      });

      const url = `https://github.com/${args.owner}/${args.repo}.git`;
      const encryptedToken =
        this.gitRepositoriesService.encryptCredential(patToken);

      if (existing) {
        await this.gitRepositoriesDao.updateById(existing.id, {
          url,
          encryptedToken,
        });
      } else {
        await this.gitRepositoriesDao.create({
          owner: args.owner,
          repo: args.repo,
          url,
          provider: GitRepositoryProvider.GITHUB,
          createdBy: userId,
          encryptedToken,
        });
      }
    } catch (error) {
      // Log error but don't fail the clone operation
      this.logger.warn(
        `Failed to track repository ${args.owner}/${args.repo}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
