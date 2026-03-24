import { HumanMessage } from '@langchain/core/messages';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { GitHubIssuePayload } from '../../git-auth/git-auth.types';
import { GitHubWebhookSubscriptionService } from '../../git-auth/services/webhook-subscription-registry.service';
import { TriggerEvent, TriggerStatus } from '../agent-triggers.types';
import { BaseTrigger } from './base-trigger';

export interface GitHubIssuesTriggerConfig {
  repositoryIds: string[];
  watchedRepoFullNames: string[];
  labels?: string[];
  titleRegexp?: string;
}

@Injectable({ scope: Scope.TRANSIENT })
export class GitHubIssuesTrigger extends BaseTrigger<
  GitHubIssuesTriggerConfig,
  GitHubIssuePayload
> {
  private triggerId!: string;
  private config!: GitHubIssuesTriggerConfig;
  private registry!: GitHubWebhookSubscriptionService;
  private installationId!: number | null;

  constructor(logger: DefaultLogger) {
    super(logger);
  }

  initialize(
    triggerId: string,
    config: GitHubIssuesTriggerConfig,
    registry: GitHubWebhookSubscriptionService,
    installationId: number | null,
  ): void {
    this.triggerId = triggerId;
    this.config = config;
    this.registry = registry;
    this.installationId = installationId;
  }

  async start(): Promise<void> {
    try {
      this.status = TriggerStatus.LISTENING;
      this.registry.register(
        this.triggerId,
        this,
        this.installationId,
        this.config.watchedRepoFullNames,
      );
      this.emit({ type: 'start', data: { config: this.config } });
    } catch (error) {
      this.emit({ type: 'start', data: { config: this.config, error } });
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.status = TriggerStatus.DESTROYED;
      this.registry.unregister(this.triggerId);
      this.emit({ type: 'stop', data: {} });
    } catch (error) {
      this.emit({ type: 'stop', data: { error } });
      throw error;
    }
  }

  async handleWebhookPayload(payload: GitHubIssuePayload): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    if (!this.matchesConfig(payload)) {
      return;
    }

    const event: TriggerEvent<GitHubIssuePayload> = {
      triggerId: this.triggerId,
      timestamp: new Date(),
      payload,
    };

    try {
      const result = await this.handleTriggerEvent(event, {});
      this.emit({
        type: 'invoke',
        data: {
          messages: this.convertPayloadToMessages(payload),
          config: {},
          result,
        },
      });
    } catch (error) {
      this.emit({
        type: 'invoke',
        data: {
          messages: this.convertPayloadToMessages(payload),
          config: {},
          error,
        },
      });
    }
  }

  getWatchedRepoFullNames(): string[] {
    return this.config.watchedRepoFullNames;
  }

  private matchesConfig(payload: GitHubIssuePayload): boolean {
    // Check repo is watched
    if (
      !this.config.watchedRepoFullNames.includes(payload.repository.full_name)
    ) {
      return false;
    }

    // Label filter (AND with other filters)
    if (this.config.labels && this.config.labels.length > 0) {
      const configLabels = new Set(
        this.config.labels.map((l) => l.toLowerCase()),
      );

      if (payload.action === 'labeled' && payload.label) {
        // For labeled action, check only the newly added label
        if (!configLabels.has(payload.label.name.toLowerCase())) {
          return false;
        }
      } else {
        // For other actions, check all issue labels
        const issueLabels = payload.issue.labels.map((l) =>
          l.name.toLowerCase(),
        );
        const hasMatch = issueLabels.some((l) => configLabels.has(l));
        if (!hasMatch) {
          return false;
        }
      }
    }

    // Title regexp filter (AND with other filters)
    // The regexp is validated at compile time (safe-regex2), but we still
    // wrap in try/catch as a defence-in-depth measure.
    if (this.config.titleRegexp) {
      try {
        const regex = new RegExp(this.config.titleRegexp);
        if (!regex.test(payload.issue.title)) {
          return false;
        }
      } catch (error) {
        this.logger?.debug(
          `titleRegexp test failed for trigger ${this.triggerId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    }

    return true;
  }

  protected convertPayloadToMessages(
    payload: GitHubIssuePayload,
  ): HumanMessage[] {
    const labels =
      payload.issue.labels.length > 0
        ? payload.issue.labels.map((l) => l.name).join(', ')
        : '(none)';

    const body = payload.issue.body || '(no description)';

    const content = [
      `A GitHub issue was ${payload.action} on ${payload.repository.full_name}.`,
      '',
      `**Issue #${payload.issue.number}: ${payload.issue.title}**`,
      `URL: ${payload.issue.html_url}`,
      `Author: ${payload.issue.user.login}`,
      `Labels: ${labels}`,
      '',
      '**Description:**',
      body,
    ].join('\n');

    return [new HumanMessage(content)];
  }
}
