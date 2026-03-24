import { createHmac } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GitHubIssuesTrigger } from '../../../v1/agent-triggers/services/github-issues-trigger';
import { GitHubIssuePayload } from '../../../v1/git-auth/git-auth.types';
import { GitHubWebhookSignatureService } from '../../../v1/git-auth/services/github-webhook-signature.service';
import { GitHubWebhookSubscriptionService } from '../../../v1/git-auth/services/webhook-subscription-registry.service';
import { createTestModule } from '../setup';

function createPayload(
  overrides: Partial<GitHubIssuePayload> = {},
): GitHubIssuePayload {
  return {
    action: 'opened',
    issue: {
      number: 42,
      title: 'Integration test issue',
      body: 'This is a test issue body',
      html_url: 'https://github.com/test-owner/test-repo/issues/42',
      updated_at: '2025-01-01T00:00:00Z',
      labels: [{ name: 'bug' }],
      user: { login: 'testuser' },
    },
    repository: {
      full_name: 'test-owner/test-repo',
      owner: { login: 'test-owner' },
      name: 'test-repo',
    },
    ...overrides,
  };
}

describe('Webhooks Integration Tests', () => {
  let app: INestApplication;
  let registry: GitHubWebhookSubscriptionService;

  beforeAll(async () => {
    app = await createTestModule();
    registry = app.get(GitHubWebhookSubscriptionService);
  });

  afterAll(async () => {
    const suppressRedisClose = (reason: unknown) => {
      if (
        reason instanceof Error &&
        reason.message === 'Connection is closed.'
      ) {
        return;
      }
      throw reason;
    };
    process.on('unhandledRejection', suppressRedisClose);

    await app.close();

    process.removeListener('unhandledRejection', suppressRedisClose);
  });

  describe('GitHubWebhookSignatureService', () => {
    it('is injectable and verifies signature logic with known secret', () => {
      // The environment may have an empty secret in test mode (no GITHUB_WEBHOOK_SECRET set).
      // Verify the service is properly wired in the DI container and
      // behaves correctly: empty secret -> returns false.
      const signatureService = app.get(GitHubWebhookSignatureService);
      const body = Buffer.from('{"test":true}');

      // With empty/unset secret, signature verification should return false
      const hmac = createHmac('sha256', 'any-secret')
        .update(body)
        .digest('hex');
      expect(signatureService.verify(body, `sha256=${hmac}`)).toBe(false);
      expect(signatureService.verify(body, undefined)).toBe(false);
    });
  });

  describe('GitHubWebhookSubscriptionService dispatch', () => {
    it('dispatches issues event to registered trigger and trigger processes it', async () => {
      const handleCalls: GitHubIssuePayload[] = [];

      const mockTrigger = {
        handleWebhookPayload: vi.fn(async (p: GitHubIssuePayload) => {
          handleCalls.push(p);
        }),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      registry.register('int-test-1', mockTrigger, 1, ['test-owner/test-repo']);

      try {
        const payload = createPayload();
        await registry.dispatch('issues', payload);

        expect(handleCalls).toHaveLength(1);
        expect(handleCalls[0]!.issue.number).toBe(42);
        expect(handleCalls[0]!.action).toBe('opened');
      } finally {
        registry.unregister('int-test-1');
      }
    });

    it('does not dispatch for unsupported event types', async () => {
      const mockTrigger = {
        handleWebhookPayload: vi.fn(),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      registry.register('int-test-2', mockTrigger, 1, ['test-owner/test-repo']);

      try {
        await registry.dispatch('push', createPayload());
        expect(mockTrigger.handleWebhookPayload).not.toHaveBeenCalled();
      } finally {
        registry.unregister('int-test-2');
      }
    });

    it('does not dispatch for unsupported issue actions', async () => {
      const mockTrigger = {
        handleWebhookPayload: vi.fn(),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      registry.register('int-test-3', mockTrigger, 1, ['test-owner/test-repo']);

      try {
        await registry.dispatch('issues', createPayload({ action: 'closed' }));
        expect(mockTrigger.handleWebhookPayload).not.toHaveBeenCalled();
      } finally {
        registry.unregister('int-test-3');
      }
    });

    it('fan-out: dispatches to multiple triggers for the same event', async () => {
      const trigger1Calls: GitHubIssuePayload[] = [];
      const trigger2Calls: GitHubIssuePayload[] = [];

      const mockTrigger1 = {
        handleWebhookPayload: vi.fn(async (p: GitHubIssuePayload) => {
          trigger1Calls.push(p);
        }),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      const mockTrigger2 = {
        handleWebhookPayload: vi.fn(async (p: GitHubIssuePayload) => {
          trigger2Calls.push(p);
        }),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      registry.register('int-fan-1', mockTrigger1, 1, ['test-owner/test-repo']);
      registry.register('int-fan-2', mockTrigger2, 1, ['test-owner/test-repo']);

      try {
        await registry.dispatch('issues', createPayload());

        expect(trigger1Calls).toHaveLength(1);
        expect(trigger2Calls).toHaveLength(1);
      } finally {
        registry.unregister('int-fan-1');
        registry.unregister('int-fan-2');
      }
    });

    it('dispatching same payload twice fires trigger twice (no dedup in dispatch path)', async () => {
      const handleCalls: GitHubIssuePayload[] = [];

      const mockTrigger = {
        handleWebhookPayload: vi.fn(async (p: GitHubIssuePayload) => {
          handleCalls.push(p);
        }),
        getWatchedRepoFullNames: () => ['test-owner/test-repo'],
      };

      registry.register('int-noddedup-1', mockTrigger, 999, [
        'test-owner/test-repo',
      ]);

      try {
        const payload = createPayload({ installation: { id: 999 } });
        await registry.dispatch('issues', payload);
        await registry.dispatch('issues', payload);

        expect(handleCalls).toHaveLength(2);
      } finally {
        registry.unregister('int-noddedup-1');
      }
    });
  });

  describe('GitHubIssuesTrigger filtering', () => {
    it('filters by repo, label, and title regexp end-to-end', async () => {
      const trigger = await app.resolve(GitHubIssuesTrigger);

      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });

      trigger.initialize(
        'int-filter-test',
        {
          repositoryIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
          watchedRepoFullNames: ['test-owner/test-repo'],
          labels: ['bug'],
          titleRegexp: '^\\[BUG\\]',
        },
        registry,
        12345,
      );
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      try {
        // Should not fire: title doesn't match regexp
        await trigger.handleWebhookPayload(createPayload());
        expect(invokeAgent).not.toHaveBeenCalled();

        // Should fire: title matches and has bug label
        await trigger.handleWebhookPayload(
          createPayload({
            issue: {
              number: 1,
              title: '[BUG] Something broken',
              body: 'details',
              html_url: 'https://github.com/test-owner/test-repo/issues/1',
              updated_at: '2025-01-01T00:00:00Z',
              labels: [{ name: 'bug' }],
              user: { login: 'user' },
            },
          }),
        );
        expect(invokeAgent).toHaveBeenCalledTimes(1);
      } finally {
        await trigger.stop();
      }
    });
  });
});
