import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { RequestError } from '@octokit/request-error';
import dedent from 'dedent';
import { isPlainObject } from 'lodash';
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

  closesIssues: z
    .array(z.number().int().positive())
    .optional()
    .describe('Issue numbers to reference in body (tool can append).'),
}).superRefine((val, ctx) => {
  const count = (val.reviewers?.length ?? 0) + (val.teamReviewers?.length ?? 0);
  if (count > 15) {
    ctx.addIssue({
      code: 'custom',
      message: 'reviewers + teamReviewers cannot exceed 15 entries',
      path: ['reviewers'],
    });

    ctx.addIssue({
      code: 'custom',
      message: 'reviewers + teamReviewers cannot exceed 15 entries',
      path: ['teamReviewers'],
    });
  }
});

export type GhCreatePullRequestToolSchemaType = z.infer<
  typeof GhCreatePullRequestToolSchema
>;

type GhCreatePullRequestToolConfig = GhBaseToolConfig & {
  /**
   * Labels that will always be applied when creating PRs, merged with `args.labels`.
   */
  additionalLabels?: string[];
};

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
      };
      warnings?: string[];
    }
  | { success: false; error: string };

type AppliedMetadata = NonNullable<
  Extract<GhCreatePullRequestToolOutput, { success: true }>['applied']
>;

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

@Injectable()
export class GhCreatePullRequestTool extends GhBaseTool<
  GhCreatePullRequestToolSchemaType,
  GhCreatePullRequestToolConfig,
  GhCreatePullRequestToolOutput
> {
  public name = 'gh_create_pull_request';
  public description =
    'Create a GitHub Pull Request in a repository and optionally apply metadata (labels, assignees, reviewers).';

  private getLabelsToApply(
    args: GhCreatePullRequestToolSchemaType,
    config: GhCreatePullRequestToolConfig,
  ): string[] | undefined {
    return this.mergeUniqueStrings(config.additionalLabels, args.labels);
  }

  private buildPullRequestBody(args: GhCreatePullRequestToolSchemaType) {
    const baseBody = args.body;
    return args.closesIssues?.length
      ? this.appendClosesIssues(baseBody, args.closesIssues)
      : baseBody;
  }

  private formatGitHubError(error: unknown): string {
    if (error instanceof RequestError) {
      const status: number = error.status;
      const message: string = error.message;

      const responseData: unknown = error.response?.data;
      const responseRecord: Record<string, unknown> | undefined = isPlainObject(
        responseData,
      )
        ? (responseData as Record<string, unknown>)
        : undefined;
      const responseMessage: unknown = responseRecord?.['message'];
      const responseErrors: unknown = responseRecord?.['errors'];

      const parts: string[] = [`GitHubError(${status}):`, message];

      if (typeof responseMessage === 'string' && responseMessage.length) {
        parts.push(`- ${responseMessage}`);
      }

      if (Array.isArray(responseErrors) && responseErrors.length) {
        // Keep this stable + reasonably small; Octokit errors can be verbose.
        parts.push(
          `- errors: ${JSON.stringify(responseErrors).slice(0, 2000)}`,
        );
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

  private mergeUniqueStrings(
    ...parts: (string[] | undefined)[]
  ): string[] | undefined {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const part of parts) {
      if (!part?.length) continue;
      for (const item of part) {
        const value = item.trim();
        if (!value) continue;
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
      }
    }

    return out.length ? out : undefined;
  }

  private appendClosesIssues(
    body: string | undefined,
    closesIssues: number[],
  ): string | undefined {
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

  private extractLabelNames(
    labels: GitHubLabel[] | undefined,
  ): string[] | undefined {
    const names = labels
      ?.map((l) => l.name)
      .filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );

    return names?.length ? names : undefined;
  }

  private extractLogins(
    users: { login?: string | null }[] | undefined,
  ): string[] | undefined {
    const logins = users
      ?.map((u) => u.login)
      .filter(
        (login): login is string =>
          typeof login === 'string' && login.length > 0,
      );

    return logins?.length ? logins : undefined;
  }

  private extractTeamSlugs(
    teams: { slug?: string | null }[] | undefined,
  ): string[] | undefined {
    const slugs = teams
      ?.map((t) => t.slug)
      .filter(
        (slug): slug is string => typeof slug === 'string' && slug.length > 0,
      );

    return slugs?.length ? slugs : undefined;
  }

  private async createPullRequest(
    client: ReturnType<GhCreatePullRequestTool['createClient']>,
    args: GhCreatePullRequestToolSchemaType,
  ): Promise<CreatedPullRequest> {
    const res = await client.pulls.create({
      owner: args.owner,
      repo: args.repo,
      title: args.title,
      head: args.head,
      base: args.base,
      body: this.buildPullRequestBody(args),
      draft: args.draft,
    });

    return {
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
  }

  private async tryApplyIssueMetadata(params: {
    client: ReturnType<GhCreatePullRequestTool['createClient']>;
    args: GhCreatePullRequestToolSchemaType;
    pullRequestNumber: number;
    labelsToApply: string[] | undefined;
  }): Promise<
    | {
        applied?: Pick<AppliedMetadata, 'labels' | 'assignees'>;
        warning?: never;
      }
    | { applied?: never; warning: string }
    | { applied?: never; warning?: never }
  > {
    const { client, args, pullRequestNumber, labelsToApply } = params;

    if (!labelsToApply?.length && !args.assignees?.length) {
      return {};
    }

    try {
      const issueRes = await client.issues.update({
        owner: args.owner,
        repo: args.repo,
        issue_number: pullRequestNumber,
        labels: labelsToApply,
        assignees: args.assignees,
      });

      const data = issueRes.data as IssuesUpdateResponseData;
      return {
        applied: {
          labels: this.extractLabelNames(data.labels),
          assignees: this.extractLogins(data.assignees),
        },
      };
    } catch (error) {
      return {
        warning: `Failed to apply issue metadata: ${this.formatGitHubError(error)}`,
      };
    }
  }

  private async tryRequestReviewers(params: {
    client: ReturnType<GhCreatePullRequestTool['createClient']>;
    args: GhCreatePullRequestToolSchemaType;
    pullRequestNumber: number;
  }): Promise<
    | {
        applied?: Pick<AppliedMetadata, 'reviewers' | 'teamReviewers'>;
        warning?: never;
      }
    | { applied?: never; warning: string }
    | { applied?: never; warning?: never }
  > {
    const { client, args, pullRequestNumber } = params;

    const totalReviewers =
      (args.reviewers?.length ?? 0) + (args.teamReviewers?.length ?? 0);

    // NOTE: the combined reviewer constraint is not guaranteed to be enforced by Ajv
    // because it is defined in Zod via `superRefine`.
    if (!totalReviewers || totalReviewers > 15) {
      return {};
    }

    try {
      const reviewersRes = await client.pulls.requestReviewers({
        owner: args.owner,
        repo: args.repo,
        pull_number: pullRequestNumber,
        reviewers: args.reviewers,
        team_reviewers: args.teamReviewers,
      });

      const reviewersData =
        reviewersRes.data as PullsRequestReviewersResponseData;

      return {
        applied: {
          reviewers: this.extractLogins(reviewersData.requested_reviewers),
          teamReviewers: this.extractTeamSlugs(reviewersData.requested_teams),
        },
      };
    } catch (error) {
      return {
        warning: `Failed to request reviewers: ${this.formatGitHubError(error)}`,
      };
    }
  }

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
      - You want to set labels / assignees and request reviewers in one step.

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
        "teamReviewers": ["platform"]
      }
      \`\`\`

      ### Troubleshooting
      - 422 Validation Failed: typically means \`head\` or \`base\` is wrong (or the branch doesn't exist).
      - 401/403: check PAT scopes and repository access.
    `;
  }

  public get schema() {
    return GhCreatePullRequestToolSchema;
  }

  public async invoke(
    args: GhCreatePullRequestToolSchemaType,
    config: GhCreatePullRequestToolConfig,
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

    const warnings: string[] = [];
    let applied: AppliedMetadata | undefined;

    // Step 1: create PR
    let created: CreatedPullRequest;
    try {
      created = await this.createPullRequest(client, validated);
    } catch (error) {
      return {
        output: { success: false, error: this.formatGitHubError(error) },
      };
    }

    const labelsToApply = this.getLabelsToApply(validated, config);

    // Step 2: apply metadata (labels/assignees)
    const issueMetaResult = await this.tryApplyIssueMetadata({
      client,
      args: validated,
      pullRequestNumber: created.number,
      labelsToApply,
    });
    if ('warning' in issueMetaResult && issueMetaResult.warning) {
      warnings.push(issueMetaResult.warning);
    } else if (issueMetaResult.applied) {
      applied = { ...(applied ?? {}), ...issueMetaResult.applied };
    }

    // Step 3: request reviewers
    const reviewersResult = await this.tryRequestReviewers({
      client,
      args: validated,
      pullRequestNumber: created.number,
    });
    if ('warning' in reviewersResult && reviewersResult.warning) {
      warnings.push(reviewersResult.warning);
    } else if (reviewersResult.applied) {
      applied = { ...(applied ?? {}), ...reviewersResult.applied };
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
