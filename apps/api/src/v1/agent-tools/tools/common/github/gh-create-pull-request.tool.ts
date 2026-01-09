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

export const GhCreatePullRequestToolSchema = GhBaseToolSchema.extend({
  title: z.string().min(1),
  body: z.string().optional(),

  head: z
    .string()
    .min(1)
    .describe(
      "The name of the branch where your changes are implemented. For same-repo: 'feature-branch'. For forks: 'owner:branch'.",
    ),
  base: z
    .string()
    .min(1)
    .describe("The branch you want to merge into (e.g., 'main')."),

  draft: z.boolean().optional().describe('Create as draft PR (default false).'),
  maintainerCanModify: z
    .boolean()
    .optional()
    .describe(
      'Allow maintainers to modify (default true for same-repo; may be ignored).',
    ),

  labels: z.array(z.string().min(1)).optional(),
  assignees: z.array(z.string().min(1)).optional().describe('Usernames'),
  reviewers: z.array(z.string().min(1)).optional().describe('Usernames'),
  teamReviewers: z
    .array(z.string().min(1))
    .optional()
    .describe('Team slugs (org only)'),
  milestoneNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Milestone number (not title).'),

  closesIssues: z
    .array(z.number().int().positive())
    .optional()
    .describe('Issue numbers to reference in body (tool can append).'),
});

export type GhCreatePullRequestToolSchemaType = z.infer<
  typeof GhCreatePullRequestToolSchema
>;

type GhCreatePullRequestToolOutput = {
  error?: string;

  success?: boolean;
  owner?: string;
  repo?: string;

  pullRequest?: {
    number: number;
    id: number;
    nodeId?: string;
    url: string;
    apiUrl: string;
    state: 'open' | 'closed';
    draft: boolean;
    title: string;
    body?: string | null;
    base: { ref: string; sha?: string; repoFullName?: string };
    head: { ref: string; sha?: string; repoFullName?: string };
    createdAt?: string;
    updatedAt?: string;
  };

  applied?: {
    labels?: string[];
    assignees?: string[];
    reviewers?: string[];
    teamReviewers?: string[];
    milestoneNumber?: number;
  };

  warnings?: string[];
};

type GitHubRateLimitHeaders = {
  'x-ratelimit-remaining'?: string;
  'x-ratelimit-reset'?: string;
};

type OctokitErrorLike = {
  status?: number;
  message?: string;
  response?: {
    data?: {
      message?: string;
      errors?: unknown;
    };
    headers?: GitHubRateLimitHeaders;
  };
};

function asOctokitErrorLike(error: unknown): OctokitErrorLike {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  return error as OctokitErrorLike;
}

function formatGitHubError(error: unknown): string {
  const err = asOctokitErrorLike(error);

  const status = typeof err.status === 'number' ? err.status : undefined;

  const responseMessage = err.response?.data?.message;
  const responseErrors = err.response?.data?.errors;

  const baseMessage =
    typeof err.message === 'string' && err.message.length
      ? err.message
      : 'Unknown GitHub error';

  const parts: string[] = [];

  if (status != null) {
    parts.push(`GitHubError(${status}):`);
  } else {
    parts.push('GitHubError:');
  }

  parts.push(baseMessage);

  if (typeof responseMessage === 'string' && responseMessage.length) {
    parts.push(`- ${responseMessage}`);
  }

  if (Array.isArray(responseErrors) && responseErrors.length) {
    // Keep this stable + reasonably small; Octokit errors can be verbose.
    parts.push(`- errors: ${JSON.stringify(responseErrors).slice(0, 2000)}`);
  }

  if (status === 401 || status === 403) {
    parts.push('- Not authorized. Check PAT scopes and repo access.');

    const headers = err.response?.headers;
    const remaining = headers?.['x-ratelimit-remaining'];
    const reset = headers?.['x-ratelimit-reset'];

    // Some rate limit errors surface as 403.
    if (remaining === '0' && typeof reset === 'string') {
      parts.push(`- Rate limit exceeded. Reset: ${reset}`);
    }
  }

  return parts.join(' ');
}

function appendClosesIssues(body: string | undefined, closesIssues: number[]) {
  if (!closesIssues.length) return body;

  const existingBody = body ?? '';

  const linesToAppend = closesIssues.map((n) => `Closes #${n}`);

  // If a line already exists, skip appending that issue.
  const existingLower = existingBody.toLowerCase();
  const filtered = linesToAppend.filter(
    (line) => !existingLower.includes(line.toLowerCase()),
  );

  if (!filtered.length) return body;

  const separator = existingBody.trim().length ? '\n\n' : '';
  return `${existingBody}${separator}${filtered.join('\n')}`;
}

@Injectable()
export class GhCreatePullRequestTool extends GhBaseTool<GhCreatePullRequestToolSchemaType> {
  public name = 'gh_create_pull_request';
  public description =
    'Create a GitHub Pull Request in a repository and optionally apply metadata (labels, assignees, milestone, reviewers).';

  protected override generateTitle(
    args: GhCreatePullRequestToolSchemaType,
    _config: GhBaseToolConfig,
  ): string {
    return `Creating PR ${args.owner}/${args.repo}: ${args.title}`;
  }

  public getDetailedInstructions(
    _config: GhBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Creates a Pull Request in GitHub using the GitHub REST API (Octokit) and then optionally applies issue metadata and review requests.

      ### When to Use
      - You have pushed a branch and want to open a PR programmatically.
      - You want to set labels / assignees / milestone and request reviewers in one step.

      ### Inputs
      - \`owner\`, \`repo\`: Repository coordinates
      - \`title\`: PR title (required)
      - \`head\`: Source branch (required). Same repo: \`branch-name\`; Fork: \`forkOwner:branch-name\`.
      - \`base\`: Target branch (required)

      ### Examples
      **Create a basic PR:**
      \`\`\`json
      {
        "owner": "acme",
        "repo": "demo",
        "title": "Add search filters",
        "head": "feat/search-filters",
        "base": "main"
      }
      \`\`\`

      **Create PR + apply metadata:**
      \`\`\`json
      {
        "owner": "acme",
        "repo": "demo",
        "title": "Fix login redirect",
        "head": "fix/login-redirect",
        "base": "main",
        "labels": ["bug"],
        "assignees": ["octocat"],
        "reviewers": ["reviewer1"],
        "teamReviewers": ["platform"],
        "milestoneNumber": 3
      }
      \`\`\`

      ### Troubleshooting
      - 422 Validation Failed: typically means \`head\` or \`base\` is wrong (or the branch doesn't exist).
      - 401/403: check PAT scopes and repository access.
    `;
  }

  public get schema() {
    return z.toJSONSchema(GhCreatePullRequestToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: GhCreatePullRequestToolSchemaType,
    config: GhBaseToolConfig,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCreatePullRequestToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // Extra validation beyond zod
    if (args.assignees && args.assignees.length > 10) {
      return {
        output: {
          success: false,
          error: 'ValidationError: assignees cannot exceed 10 entries',
        },
        messageMetadata,
      };
    }

    if (
      (args.reviewers && args.reviewers.length) ||
      (args.teamReviewers && args.teamReviewers.length)
    ) {
      const count =
        (args.reviewers?.length ?? 0) + (args.teamReviewers?.length ?? 0);
      if (count > 15) {
        return {
          output: {
            success: false,
            error:
              'ValidationError: reviewers + teamReviewers cannot exceed 15 entries',
          },
          messageMetadata,
        };
      }
    }

    const warnings: string[] = [];
    const applied: NonNullable<GhCreatePullRequestToolOutput['applied']> = {};

    const client = this.getClient(config.patToken);

    const bodyWithCloses = args.closesIssues?.length
      ? appendClosesIssues(args.body, args.closesIssues)
      : args.body;

    try {
      const prRes = await client.pulls.create({
        owner: args.owner,
        repo: args.repo,
        title: args.title,
        head: args.head,
        base: args.base,
        body: bodyWithCloses,
        draft: args.draft,
        maintainer_can_modify: args.maintainerCanModify,
      });

      const pr = prRes.data;
      const issueNumber = pr.number;

      // Apply issue metadata (labels/assignees/milestone) via Issues API
      if (
        (args.labels && args.labels.length) ||
        (args.assignees && args.assignees.length) ||
        args.milestoneNumber
      ) {
        try {
          const updateRes = await client.issues.update({
            owner: args.owner,
            repo: args.repo,
            issue_number: issueNumber,
            labels: args.labels,
            assignees: args.assignees,
            milestone: args.milestoneNumber,
          });

          applied.labels = (updateRes.data.labels ?? []).map(
            (l: { name?: string | null }) => l.name ?? '',
          );
          applied.assignees = (updateRes.data.assignees ?? []).map(
            (a: { login?: string | null }) => a.login ?? '',
          );
          if (args.milestoneNumber) {
            applied.milestoneNumber = args.milestoneNumber;
          }
        } catch (e) {
          warnings.push(
            `Failed to apply issue metadata: ${formatGitHubError(e)}`,
          );
        }
      }

      // Request reviewers (users + teams)
      if (
        (args.reviewers && args.reviewers.length) ||
        (args.teamReviewers && args.teamReviewers.length)
      ) {
        try {
          const reviewersRes = await client.pulls.requestReviewers({
            owner: args.owner,
            repo: args.repo,
            pull_number: issueNumber,
            reviewers: args.reviewers,
            team_reviewers: args.teamReviewers,
          });

          applied.reviewers = (reviewersRes.data.requested_reviewers ?? []).map(
            (r: { login?: string | null }) => r.login ?? '',
          );
          applied.teamReviewers = (reviewersRes.data.requested_teams ?? []).map(
            (t: { slug?: string | null }) => t.slug ?? '',
          );
        } catch (e) {
          warnings.push(`Failed to request reviewers: ${formatGitHubError(e)}`);
        }
      }

      return {
        output: {
          success: true,
          owner: args.owner,
          repo: args.repo,
          pullRequest: {
            number: pr.number,
            id: pr.id,
            nodeId: pr.node_id,
            url: pr.html_url,
            apiUrl: pr.url,
            state: pr.state,
            draft: pr.draft,
            title: pr.title,
            body: pr.body,
            base: {
              ref: pr.base.ref,
              sha: pr.base.sha,
              repoFullName: pr.base.repo?.full_name,
            },
            head: {
              ref: pr.head.ref,
              sha: pr.head.sha,
              repoFullName: pr.head.repo?.full_name,
            },
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
          },
          applied: Object.keys(applied).length ? applied : undefined,
          warnings: warnings.length ? warnings : undefined,
        },
        messageMetadata,
      };
    } catch (error) {
      return {
        output: {
          success: false,
          error: formatGitHubError(error),
        },
        messageMetadata,
      };
    }
  }
}
