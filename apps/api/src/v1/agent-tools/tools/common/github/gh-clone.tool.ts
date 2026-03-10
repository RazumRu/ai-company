import path from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/agents.types';
import { GitRepositoriesDao } from '../../../../git-repositories/dao/git-repositories.dao';
import { GitRepositoryProvider } from '../../../../git-repositories/git-repositories.types';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import { shQuote } from '../../../../utils/shell.utils';
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
      `Custom absolute path where the repository should be cloned (e.g., "${BASE_RUNTIME_WORKDIR}/my-project"). If not provided, clones to the default runtime workspace location.`,
    ),
});

export type GhCloneToolSchemaType = z.infer<typeof GhCloneToolSchema>;

type GhCloneToolOutput = {
  error?: string;
  path?: string;
  agentInstructions?: string;
};

@Injectable()
export class GhCloneTool extends GhBaseTool<GhCloneToolSchemaType> {
  public name = 'gh_clone';
  public description =
    'Clone a GitHub repository into the runtime container and return the absolute clone path for all subsequent operations. Also discovers and returns agent instruction files from the repository root — you MUST follow the rules they define. Supports optional branch/tag checkout, shallow cloning (depth), and custom clone destinations (workdir). If the repository is already cloned, navigate to the existing path instead of re-cloning.';

  constructor(
    private readonly gitRepositoriesDao: GitRepositoriesDao,
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
      Clones a GitHub repository using authenticated HTTPS. Returns the clone path for subsequent operations and searches for agent instruction files in the repository root.

      ### Agent Instructions Discovery
      After cloning, automatically searches the repository root for agent instruction files in this priority order:
      1. ${environment.agentsInstructionsFile}
      2. CLAUDE.md
      3. .cursorrules
      4. .aidigestignore

      If found, the content is returned in the \`agentInstructions\` field. These files contain repository-specific guidance, coding conventions, and project context. **You MUST strictly follow all rules, conventions, and workflows described in the returned instructions file.** Treat the instructions as binding requirements for how you interact with the codebase — including coding style, commit conventions, branch naming, testing requirements, forbidden patterns, required commands, and any other project-specific workflow rules. Do not deviate from them unless the user explicitly overrides a specific rule.

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
      Use returned path for all operations. **If agent instructions are returned, you MUST read them carefully and strictly follow all rules, conventions, and workflows they define for the entire duration of your work on this repository.** These instructions are authoritative — they dictate coding style, commit conventions, testing requirements, forbidden patterns, required commands, and any other project-specific rules.

      **Specifically, extract and follow these from the instructions:**
      - **Build/test/lint commands** — use the exact commands specified in the instructions instead of guessing. If the instructions specify a mandatory pre-completion command (e.g., a full-check or validation script), you MUST run it before finishing.
      - **Forbidden patterns** — respect all "never do X" and "always do Y" rules.
      - **Testing conventions** — follow the repo's testing approach (specific test runners, file targeting rules, etc.).
      - When delegating to subagents, include the relevant instruction sections so subagents follow the same rules.

      Run files_find_paths to explore structure. Use shell for git commands.
    `;
  }

  public get schema() {
    return GhCloneToolSchema;
  }

  private buildCloneInnerCommand(args: GhCloneToolSchemaType): string {
    const repoUrl = `https://github.com/${args.owner}/${args.repo}.git`;
    const cmd: string[] = ['git clone --progress'];

    if (args.branch) {
      cmd.push(`--branch ${shQuote(args.branch)}`);
    }

    if (args.depth) {
      cmd.push(`--depth ${args.depth}`);
    }

    cmd.push(shQuote(repoUrl));

    if (args.workdir) {
      cmd.push(shQuote(args.workdir));
    }

    return cmd.join(' ');
  }

  private buildCloneCommand(
    args: GhCloneToolSchemaType,
    authenticated: boolean,
  ): string {
    const cloneCommand = this.buildCloneInnerCommand(args);
    const authPrefix = authenticated
      ? 'auth_header=$(printf "x-access-token:%s" "$GH_TOKEN" | base64 | tr -d "\\n")'
      : '';
    const authConfig = authenticated
      ? 'git -c http.extraHeader="Authorization: Basic $auth_header"'
      : 'git';
    const cloneInvocation = cloneCommand.replace(/^git\b/, authConfig);
    const heartbeatLabel = `${args.owner}/${args.repo}`;

    const script = [
      'set -o pipefail',
      authPrefix,
      `( ${cloneInvocation} 2>&1 | perl -pe 's/\\r/\\n/g' ) & clone_pid=$!`,
      `while kill -0 "$clone_pid" 2>/dev/null; do echo "[clone-heartbeat] ${heartbeatLabel} $(date -Iseconds)" >&2; sleep 5; done`,
      'wait "$clone_pid"',
    ]
      .filter(Boolean)
      .join('; ');

    return `bash -lc ${shQuote(script)}`;
  }

  public async invoke(
    args: GhCloneToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCloneToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // Resolve token once. Clone uses prompt-disabled git over HTTPS; when a token
    // is available we inject it via an Authorization header, otherwise we clone
    // anonymously for public repos. Both paths use a synthetic heartbeat so long
    // silent git phases do not trip Daytona's 60s inactivity timeout.
    let resolvedToken: string | null = null;
    try {
      resolvedToken = await this.resolveToken(config, args.owner);
    } catch {
      // No token available — resolvedToken stays null
    }

    let res = await this.execGhCommand(
      {
        cmd: resolvedToken
          ? this.buildCloneCommand(args, true)
          : this.buildCloneCommand(args, false),
        owner: args.owner,
        resolvedToken,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0 && resolvedToken) {
      this.logger.warn(
        `Authenticated clone failed for ${args.owner}/${args.repo}, retrying anonymously: ${res.stderr || res.stdout || 'unknown error'}`,
      );

      res = await this.execGhCommand(
        {
          cmd: this.buildCloneCommand(args, false),
          owner: args.owner,
          resolvedToken: null,
        },
        config,
        cfg,
      );
    }

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

    // Detect the default branch from the freshly cloned repo
    const detectedDefaultBranch = await this.detectDefaultBranch(
      clonePath,
      config,
      cfg,
    );

    // Track the cloned repository with GitHub token and detected default branch
    // Only store PAT tokens (App tokens are short-lived and should not be persisted)
    const userId = cfg.configurable?.graph_created_by as string | undefined;
    const projectId = cfg.configurable?.graph_project_id as string | undefined;
    if (userId && projectId) {
      await this.upsertGitRepository(
        args,
        userId,
        detectedDefaultBranch,
        projectId,
      );
    }

    // Search for agent instruction files in the repository root
    const agentInstructions = await this.findAgentInstructions(
      clonePath,
      config,
      cfg,
    );

    return {
      output: {
        path: clonePath,
        ...(agentInstructions && { agentInstructions }),
      },
      messageMetadata,
    };
  }

  private async upsertGitRepository(
    args: GhCloneToolSchemaType,
    userId: string,
    detectedDefaultBranch?: string,
    projectId?: string,
  ): Promise<void> {
    try {
      const existing = await this.gitRepositoriesDao.getOne({
        owner: args.owner,
        repo: args.repo,
        provider: GitRepositoryProvider.GITHUB,
        createdBy: userId,
      });

      const url = `https://github.com/${args.owner}/${args.repo}.git`;

      if (existing) {
        const updatePayload: Record<string, unknown> = { url };
        // Update defaultBranch if detected and changed
        if (
          detectedDefaultBranch &&
          detectedDefaultBranch !== existing.defaultBranch
        ) {
          updatePayload.defaultBranch = detectedDefaultBranch;
        }
        await this.gitRepositoriesDao.updateById(existing.id, updatePayload);
      } else {
        // projectId is always defined here — caller guards with `userId && projectId`
        await this.gitRepositoriesDao.create({
          owner: args.owner,
          repo: args.repo,
          url,
          provider: GitRepositoryProvider.GITHUB,
          defaultBranch: detectedDefaultBranch ?? 'main',
          createdBy: userId,
          projectId: projectId!,
          installationId: null,
          syncedAt: null,
        });
      }
    } catch (error) {
      // Log error but don't fail the clone operation
      this.logger.warn(
        `Failed to track repository ${args.owner}/${args.repo}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Detect the repository's default branch after cloning.
   * When no specific branch was requested, the current branch IS the default branch.
   * When a specific branch was requested, query the remote for the HEAD reference.
   */
  private async detectDefaultBranch(
    clonePath: string,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | undefined> {
    try {
      // Use `git symbolic-ref refs/remotes/origin/HEAD` to get the remote default branch
      const res = await this.execGhCommand(
        {
          cmd: `git -C ${shQuote(clonePath)} symbolic-ref refs/remotes/origin/HEAD`,
        },
        config,
        cfg,
      );

      if (res.exitCode === 0) {
        // Output looks like: refs/remotes/origin/main
        const ref = res.stdout.trim();
        const branch = ref.replace('refs/remotes/origin/', '');
        if (branch.length > 0) {
          return branch;
        }
      }

      // Fallback: read the current branch (accurate when no --branch was specified)
      const fallbackRes = await this.execGhCommand(
        {
          cmd: `git -C ${shQuote(clonePath)} symbolic-ref --short HEAD`,
        },
        config,
        cfg,
      );

      if (fallbackRes.exitCode === 0) {
        const branch = fallbackRes.stdout.trim();
        if (branch.length > 0) {
          return branch;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private async findAgentInstructions(
    clonePath: string,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | undefined> {
    try {
      // Priority order: configured default, CLAUDE.md, .cursorrules, .aidigestignore
      const instructionFiles = [
        environment.agentsInstructionsFile,
        'CLAUDE.md',
        '.cursorrules',
        '.aidigestignore',
      ];

      // Search for instruction files in the repository root
      const findCmd = instructionFiles
        .map((file) => shQuote(file))
        .join(' -o -name ');
      const searchResult = await this.execGhCommand(
        {
          cmd: `find ${shQuote(clonePath)} -maxdepth 1 -type f \\( -name ${findCmd} \\)`,
        },
        config,
        cfg,
      );

      if (searchResult.exitCode !== 0 || !searchResult.stdout.trim()) {
        return undefined;
      }

      // Get all found files and prioritize them
      const foundFiles = searchResult.stdout.trim().split('\n').filter(Boolean);
      if (foundFiles.length === 0) {
        return undefined;
      }

      // Sort by priority (based on instructionFiles order)
      const sortedFiles = foundFiles.sort((a, b) => {
        const aIndex = instructionFiles.findIndex((f) =>
          a.toLowerCase().includes(f.toLowerCase()),
        );
        const bIndex = instructionFiles.findIndex((f) =>
          b.toLowerCase().includes(f.toLowerCase()),
        );
        return aIndex - bIndex;
      });

      // Read the highest priority file
      const instructionFilePath = sortedFiles[0];
      if (!instructionFilePath) {
        return undefined;
      }

      const catResult = await this.execGhCommand(
        {
          cmd: `cat ${shQuote(instructionFilePath)}`,
        },
        config,
        cfg,
      );

      if (catResult.exitCode !== 0) {
        return undefined;
      }

      const fileName = path.basename(instructionFilePath);
      return `Found agent instructions file: ${fileName}\n\n${catResult.stdout}`;
    } catch (error) {
      // Log error but don't fail the clone operation
      this.logger.warn(
        `Failed to find agent instructions: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
