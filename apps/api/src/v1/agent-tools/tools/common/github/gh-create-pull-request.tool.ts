import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { RequestError } from '@octokit/request-error';

function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError;
}
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
      'Allow maintainers of the base repo to modify the PR branch (fork PRs).',
    ),

  labels: z.array(z.string().min(1)).optional(),
  assignees: z
    .array(z.string().min(1))
    .max(10)
    .optional()
    .describe('Usernames'),
  reviewers: z
    .array(z.string().min(1))
    .max(15)
    .optional()
    .describe('Usernames'),
  teamReviewers: z
    .array(z.string().min(1))
    .max(15)
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
}).superRefine((val, ctx) => {
  const count = (val.reviewers?.length ?? 0) + (val.teamReviewers?.length ?? 0);
  if (count > 15) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reviewers + teamReviewers cannot exceed 15 entries',
      path: ['reviewers'],
    });

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reviewers + teamReviewers cannot exceed 15 entries',
      path: ['teamReviewers'],
    });
  }
});

export type GhCreatePullRequestToolSchemaType = z.infer<
  typeof GhCreatePullRequestToolSchema
>;

type GhCreatePullRequestToolOutput =
  | {
      success: true;
      owner: string;
      repo: string;
      pullRequest: {
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
    }
  | { success: false; error: string };

function formatGitHubError(error: unknown): string {
  if (isRequestError(error)) {
    const status: number = error.status;
    const message: string = error.message;

    const responseMessage: unknown = error.response?.data?.message;
    const responseErrors: unknown = error.response?.data?.errors;

    const parts: string[] = [`GitHubError(${status}):`, message];

    if (typeof responseMessage === 'string' && responseMessage.length) {
      parts.push(`- ${responseMessage}`);
    }

    if (Array.isArray(responseErrors) && responseErrors.length) {
      // Keep this stable + reasonably small; Octokit errors can be verbose.
      parts.push(`- errors: ${JSON.stringify(responseErrors).slice(0, 2000)}`);
    }

    if (status === 401 || status === 403) {
      parts.push('- Not authorized. Check PAT scopes and repo access.');

      const remaining = error.response?.headers?.['x-ratelimit-remaining'];
      const reset = error.response?.headers?.['x-ratelimit-reset'];

      // Some rate limit errors surface as 403.
      if (remaining === '0' && typeof reset === 'string') {
        parts.push(`- Rate limit exceeded. Reset: ${reset}`);
      }
    }

    return parts.join(' ');
  }

  if (error instanceof Error) {
    return `GitHubError: ${error.message}`;
  }

  return `GitHubError: ${String(error)}`;
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

type CreatedPullRequest = {
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

type GitHubLabel = { name?: string | null };

type GitHubAssignee = { login?: string | null };

type GitHubReviewer = { login?: string | null };

type GitHubTeam = { slug?: string | null };

type IssuesUpdateResponseData = {
  labels?: GitHubLabel[];
  assignees?: GitHubAssignee[];
};

type PullsRequestReviewersResponseData = {
  requested_reviewers?: GitHubReviewer[];
  requested_teams?: GitHubTeam[];
};

function extractLabelNames(
  labels: GitHubLabel[] | undefined,
): string[] | undefined {
  const names = labels
    ?.map((l) => l.name)
    .filter((name): name is string => typeof name === 'string' && name.length);

  return names?.length ? names : undefined;
}

function extractLogins(
  users: { login?: string | null }[] | undefined,
): string[] | undefined {
  const logins = users
    ?.map((u) => u.login)
    .filter(
      (login): login is string => typeof login === 'string' && login.length,
    );

  return logins?.length ? logins : undefined;
}

function extractTeamSlugs(
  teams: { slug?: string | null }[] | undefined,
): string[] | undefined {
  const slugs = teams
    ?.map((t) => t.slug)
    .filter((slug): slug is string => typeof slug === 'string' && slug.length);

  return slugs?.length ? slugs : undefined;
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
    const schema = z.toJSONSchema(GhCreatePullRequestToolSchema) as Record<
      string,
      unknown
    >;

    // Ajv in this repo is configured for draft-07 by default; the Zod JSON schema
    // output includes a draft 2020-12 $schema ref which Ajv treats as an external ref.
    // Strip it so validation can compile.
    delete schema.$schema;

    return schema;
  }

  public async invoke(
    args: GhCreatePullRequestToolSchemaType,
    config: GhBaseToolConfig,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhCreatePullRequestToolOutput>> {
    const validated = this.validate(args);

    const token = config.patToken;
    if (!token) {
      return {
        output: {
          success: false,
          error: 'ValidationError: Missing GitHub PAT token',
        },
      };
    }

    const client = this.createClient(token);

    // Step 1: create PR
    const baseBody = validated.body;
    const bodyWithIssues = validated.closesIssues?.length
      ? appendClosesIssues(baseBody, validated.closesIssues)
      : baseBody;

    let created: CreatedPullRequest;
    try {
      const res = await client.pulls.create({
        owner: validated.owner,
        repo: validated.repo,
        title: validated.title,
        head: validated.head,
        base: validated.base,
        body: bodyWithIssues,
        draft: validated.draft,
        maintainer_can_modify: validated.maintainerCanModify,
      });

      created = {
        number: res.data.number,
        id: res.data.id,
        nodeId: res.data.node_id,
        url: res.data.html_url,
        apiUrl: res.data.url,
        state: res.data.state === 'closed' ? 'closed' : 'open',
        draft: Boolean(res.data.draft),
        title: res.data.title,
        body: res.data.body,
        base: {
          ref: res.data.base.ref,
          sha: res.data.base.sha,
          repoFullName: res.data.base.repo?.full_name,
        },
        head: {
          ref: res.data.head.ref,
          sha: res.data.head.sha,
          repoFullName: res.data.head.repo?.full_name,
        },
        createdAt: res.data.created_at,
        updatedAt: res.data.updated_at,
      };
    } catch (error) {
      return { output: { success: false, error: formatGitHubError(error) } };
    }

    // Step 2: apply metadata (labels/assignees/milestone)
    const warnings: string[] = [];
    let applied:
      | {
          labels?: string[];
          assignees?: string[];
          reviewers?: string[];
          teamReviewers?: string[];
          milestoneNumber?: number;
        }
      | undefined;

    if (
      validated.labels?.length ||
      validated.assignees?.length ||
      validated.milestoneNumber
    ) {
      try {
        const issueRes = await client.issues.update({
          owner: validated.owner,
          repo: validated.repo,
          issue_number: created.number,
          labels: validated.labels,
          assignees: validated.assignees,
          milestone: validated.milestoneNumber,
        });

        const data = issueRes.data as IssuesUpdateResponseData;
        applied = {
          labels: extractLabelNames(data.labels),
          assignees: extractLogins(data.assignees),
          milestoneNumber: validated.milestoneNumber,
        };
      } catch (error) {
        warnings.push(
          `Failed to apply issue metadata: ${formatGitHubError(error)}`,
        );
      }
    }

    // Step 3: request reviewers
    if (
      (validated.reviewers?.length || validated.teamReviewers?.length) &&
      (validated.reviewers?.length ?? 0) +
        (validated.teamReviewers?.length ?? 0) <=
        15
    ) {
      try {
        const reviewersRes = await client.pulls.requestReviewers({
          owner: validated.owner,
          repo: validated.repo,
          pull_number: created.number,
          reviewers: validated.reviewers,
          team_reviewers: validated.teamReviewers,
        });

        const reviewersData =
          reviewersRes.data as PullsRequestReviewersResponseData;

        const reviewersApplied = extractLogins(
          reviewersData.requested_reviewers,
        );
        const teamReviewersApplied = extractTeamSlugs(
          reviewersData.requested_teams,
        );

        applied = {
          ...(applied ?? {}),
          reviewers: reviewersApplied,
          teamReviewers: teamReviewersApplied,
        };
      } catch (error) {
        warnings.push(
          `Failed to request reviewers: ${formatGitHubError(error)}`,
        );
      }
    }

    const output: GhCreatePullRequestToolOutput = {
      success: true,
      owner: validated.owner,
      repo: validated.repo,
      pullRequest: created,
      applied,
      warnings: warnings.length ? warnings : undefined,
    };

    return {
      output,
      messageMetadata: {
        __title: this.generateTitle?.(validated, config),
      },
    };
  }
}
