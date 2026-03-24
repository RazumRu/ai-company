import { describe, expect, it, vi } from 'vitest';

import { GitHubWebhookSubscriptionService } from '../services/webhook-subscription-registry.service';
import { GitHubWebhookController } from './github-webhook.controller';

describe('GitHubWebhookController', () => {
  function createController() {
    const registry = {
      handleWebhook: vi.fn(),
    } as unknown as GitHubWebhookSubscriptionService;

    const controller = new GitHubWebhookController(registry);

    return { controller, registry };
  }

  it('delegates to registry.handleWebhook with raw body, signature, and event type', () => {
    const { controller, registry } = createController();
    const rawBody = Buffer.from('{"action":"opened"}');

    controller.handleGitHubWebhook(
      { rawBody } as never,
      'sha256=valid',
      'issues',
    );

    expect(registry.handleWebhook).toHaveBeenCalledWith(
      rawBody,
      'sha256=valid',
      'issues',
    );
  });

  it('passes undefined rawBody when missing', () => {
    const { controller, registry } = createController();

    controller.handleGitHubWebhook(
      { rawBody: undefined } as never,
      'sha256=valid',
      'issues',
    );

    expect(registry.handleWebhook).toHaveBeenCalledWith(
      undefined,
      'sha256=valid',
      'issues',
    );
  });
});
