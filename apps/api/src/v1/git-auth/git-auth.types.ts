import { type GraphQlQueryResponse } from '@octokit/graphql/types';

export enum GitProvider {
  GitHub = 'github',
  GitLab = 'gitlab',
}

export enum GitHubWebhookEvent {
  Issues = 'issues',
}

export enum GitHubIssueAction {
  Opened = 'opened',
  Reopened = 'reopened',
  Labeled = 'labeled',
  Edited = 'edited',
}

export interface RegisteredTrigger {
  triggerId: string;
  trigger: {
    handleWebhookPayload: (payload: GitHubIssuePayload) => Promise<void>;
    getWatchedRepoFullNames: () => string[];
  };
  installationId: number | null;
  repoFullNames: string[];
}

export interface GitHubIssueNode {
  id: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  author: { login: string } | null;
  labels: { nodes: { name: string }[] };
  repository: {
    nameWithOwner: string;
    name: string;
    owner: { login: string };
  };
}

export interface GitHubIssueSearchData {
  search: {
    nodes: GitHubIssueNode[];
  };
  rateLimit: {
    remaining: number;
    resetAt: string;
  };
}

export type GraphQLSearchResponse = GraphQlQueryResponse<GitHubIssueSearchData>;

export interface GitHubIssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    updated_at: string;
    labels: { name: string }[];
    user: { login: string };
  };
  /** Present only for the `labeled` action. */
  label?: { name: string };
  repository: {
    full_name: string;
    owner: { login: string };
    name: string;
  };
  installation?: { id: number };
}

export interface InstallationUnlinkedEvent {
  userId: string;
  provider: GitProvider;
  connectionIds: string[];
  accountLogins: string[];
  githubInstallationIds: number[];
}

export const INSTALLATION_UNLINKED_EVENT = 'installation.unlinked';
