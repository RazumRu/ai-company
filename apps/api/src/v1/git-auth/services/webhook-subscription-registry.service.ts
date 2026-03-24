import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger, UnauthorizedException } from '@packages/common';

import { PollableWebhookRegistry } from '../../webhooks/services/pollable-webhook-registry.service';
import { WebhookSubscriberType } from '../../webhooks/webhooks.types';
import {
  GitHubIssueAction,
  type GitHubIssueListResponse,
  type GitHubIssueNode,
  GitHubIssuePayload,
  GitHubWebhookEvent,
  type RegisteredTrigger,
} from '../git-auth.types';
import { GitHubAppService } from './github-app.service';
import { GitHubWebhookSignatureService } from './github-webhook-signature.service';

const RATE_LIMIT_THRESHOLD = 50;

const SUPPORTED_ISSUE_ACTIONS = new Set<string>([
  GitHubIssueAction.Opened,
  GitHubIssueAction.Reopened,
  GitHubIssueAction.Labeled,
  GitHubIssueAction.Edited,
]);

@Injectable()
export class GitHubWebhookSubscriptionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly triggers = new Map<string, RegisteredTrigger>();

  constructor(
    private readonly gitHubAppService: GitHubAppService,
    private readonly pollableRegistry: PollableWebhookRegistry,
    private readonly signatureService: GitHubWebhookSignatureService,
    private readonly logger: DefaultLogger,
  ) {}

  onModuleInit(): void {
    this.pollableRegistry.register({
      subscriberKey: WebhookSubscriberType.GhIssue,
      pollFn: async (since: Date) => {
        return await this.pollAllInstallations(since);
      },
      getDeduplicationKey: (payload: GitHubIssuePayload) => {
        return `gh_issue:${payload.repository.full_name}#${payload.issue.number}`;
      },
      onEvent: async (payload: GitHubIssuePayload) => {
        await this.fanOutToTriggers(payload);
      },
    });
  }

  onModuleDestroy(): void {
    this.pollableRegistry.unregister(WebhookSubscriberType.GhIssue);
  }

  register(
    triggerId: string,
    trigger: RegisteredTrigger['trigger'],
    installationId: number | null,
    repoFullNames: string[],
  ): void {
    this.triggers.set(triggerId, {
      triggerId,
      trigger,
      installationId,
      repoFullNames,
    });

    this.logger.log(
      `Registered webhook trigger ${triggerId} for repos: ${repoFullNames.join(', ')}`,
    );
  }

  unregister(triggerId: string): void {
    this.triggers.delete(triggerId);
    this.logger.log(`Unregistered webhook trigger ${triggerId}`);
  }

  handleWebhook(
    rawBody: Buffer | undefined,
    signatureHeader: string | undefined,
    eventType: string | undefined,
  ): void {
    if (!rawBody) {
      throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
    }

    if (!this.signatureService.verify(rawBody, signatureHeader)) {
      throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID');
    }

    if (!eventType) {
      return;
    }

    const payload = JSON.parse(rawBody.toString()) as GitHubIssuePayload;

    this.logger.debug(
      `[handleWebhook] event=${eventType} action=${payload.action} issue=#${payload.issue?.number} repo=${payload.repository?.full_name}`,
    );

    void this.dispatch(eventType, payload).catch((error: unknown) => {
      this.logger.error(
        `Webhook dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async dispatch(
    eventType: string,
    payload: GitHubIssuePayload,
  ): Promise<void> {
    if (eventType !== GitHubWebhookEvent.Issues) {
      return;
    }

    if (!SUPPORTED_ISSUE_ACTIONS.has(payload.action)) {
      return;
    }

    await this.fanOutToTriggers(payload);
  }

  private async fanOutToTriggers(payload: GitHubIssuePayload): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const entry of this.triggers.values()) {
      promises.push(
        entry.trigger.handleWebhookPayload(payload).catch((error) => {
          this.logger.error(
            `Webhook dispatch failed for trigger ${entry.triggerId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      );
    }

    await Promise.all(promises);
  }

  private async pollAllInstallations(
    since: Date,
  ): Promise<GitHubIssuePayload[]> {
    this.logger.debug(
      `[pollAllInstallations] triggers count=${this.triggers.size} since=${since.toISOString()}`,
    );

    const installationRepos = new Map<number, Set<string>>();

    for (const entry of this.triggers.values()) {
      if (entry.installationId === null) {
        continue;
      }

      const existing =
        installationRepos.get(entry.installationId) ?? new Set<string>();
      for (const repo of entry.repoFullNames) {
        existing.add(repo);
      }
      installationRepos.set(entry.installationId, existing);
    }

    const results: GitHubIssuePayload[] = [];

    for (const [installationId, repos] of installationRepos) {
      if (repos.size === 0) {
        continue;
      }

      const token =
        await this.gitHubAppService.getInstallationToken(installationId);
      const issues = await this.fetchRecentIssues(token, [...repos], since);
      for (const issue of issues) {
        results.push(this.mapNodeToPayload(issue));
      }
    }

    return results;
  }

  private async fetchRecentIssues(
    token: string,
    repos: string[],
    since: Date,
  ): Promise<GitHubIssueNode[]> {
    const sinceISO = since.toISOString();
    const allNodes: GitHubIssueNode[] = [];

    for (const repoFullName of repos) {
      const [owner, name] = repoFullName.split('/');

      this.logger.debug(
        `[fetchRecentIssues] repo=${repoFullName} since=${sinceISO}`,
      );

      const query = `
        query($owner: String!, $name: String!, $since: DateTime!) {
          repository(owner: $owner, name: $name) {
            issues(
              filterBy: { since: $since, states: OPEN }
              first: 100
              orderBy: { field: UPDATED_AT, direction: DESC }
            ) {
              nodes {
                id
                number
                title
                body
                url
                state
                createdAt
                updatedAt
                author { login }
                labels(first: 20) { nodes { name } }
              }
            }
            nameWithOwner
            name
            owner { login }
          }
          rateLimit {
            remaining
            resetAt
          }
        }
      `;

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Geniro-Webhook-Reconciler',
        },
        body: JSON.stringify({
          query,
          variables: { owner, name, since: sinceISO },
        }),
      });

      if (!response.ok) {
        throw new Error(
          `GitHub GraphQL request failed with status ${response.status}`,
        );
      }

      const result = (await response.json()) as GitHubIssueListResponse;

      if (!result.data) {
        throw new Error(
          `GitHub GraphQL response contained errors: ${JSON.stringify(result.errors)}`,
        );
      }

      if (result.data.rateLimit.remaining < RATE_LIMIT_THRESHOLD) {
        this.logger.debug(
          `GitHub rate limit low (${result.data.rateLimit.remaining} remaining, resets at ${result.data.rateLimit.resetAt}). Future reconciliation cycles may be throttled.`,
        );
      }

      const repoData = result.data.repository;
      const nodes = repoData.issues.nodes.map((node) => ({
        ...node,
        repository: {
          nameWithOwner: repoData.nameWithOwner,
          name: repoData.name,
          owner: { login: repoData.owner.login },
        },
      }));

      this.logger.debug(
        `[fetchRecentIssues] repo=${repoFullName} nodes count=${nodes.length}: ${JSON.stringify(nodes.map((n) => ({ number: n.number, state: n.state, updatedAt: n.updatedAt, labels: n.labels.nodes.map((l) => l.name) })))}`,
      );

      allNodes.push(...nodes);
    }

    return allNodes;
  }

  private mapNodeToPayload(node: GitHubIssueNode): GitHubIssuePayload {
    const action =
      node.createdAt === node.updatedAt
        ? GitHubIssueAction.Opened
        : GitHubIssueAction.Edited;

    return {
      action,
      issue: {
        number: node.number,
        title: node.title,
        body: node.body,
        html_url: node.url,
        updated_at: node.updatedAt,
        labels: node.labels.nodes.map((l) => ({ name: l.name })),
        user: { login: node.author?.login ?? 'unknown' },
      },
      repository: {
        full_name: node.repository.nameWithOwner,
        owner: { login: node.repository.owner.login },
        name: node.repository.name,
      },
    };
  }
}
