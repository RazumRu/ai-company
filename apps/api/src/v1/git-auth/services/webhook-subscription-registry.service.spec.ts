import { DefaultLogger, UnauthorizedException } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PollableWebhookRegistry } from '../../webhooks/services/pollable-webhook-registry.service';
import {
  GitHubIssueAction,
  type GitHubIssueListResponse,
  GitHubIssueNode,
  GitHubIssuePayload,
} from '../git-auth.types';
import { GitHubAppService } from './github-app.service';
import { GitHubWebhookSignatureService } from './github-webhook-signature.service';
import { GitHubWebhookSubscriptionService } from './webhook-subscription-registry.service';

function createPayload(
  overrides: Partial<GitHubIssuePayload> = {},
): GitHubIssuePayload {
  return {
    action: 'opened',
    issue: {
      number: 1,
      title: 'Test',
      body: null,
      html_url: 'https://github.com/owner/repo/issues/1',
      updated_at: '2025-01-01T00:00:00Z',
      labels: [],
      user: { login: 'user' },
    },
    repository: {
      full_name: 'owner/repo',
      owner: { login: 'owner' },
      name: 'repo',
    },
    ...overrides,
  };
}

function createMockTrigger() {
  return {
    handleWebhookPayload: vi.fn().mockResolvedValue(undefined),
    getWatchedRepoFullNames: vi.fn().mockReturnValue(['owner/repo']),
  };
}

describe('GitHubWebhookSubscriptionService', () => {
  let service: GitHubWebhookSubscriptionService;
  let logger: DefaultLogger;
  let gitHubAppService: GitHubAppService;
  let pollableRegistry: PollableWebhookRegistry;
  let signatureService: GitHubWebhookSignatureService;

  beforeEach(() => {
    logger = {
      log: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as DefaultLogger;

    gitHubAppService = {
      getInstallationToken: vi.fn(),
    } as unknown as GitHubAppService;

    pollableRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
    } as unknown as PollableWebhookRegistry;

    signatureService = {
      verify: vi.fn().mockReturnValue(true),
    } as unknown as GitHubWebhookSignatureService;

    service = new GitHubWebhookSubscriptionService(
      gitHubAppService,
      pollableRegistry,
      signatureService,
      logger,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.restoreAllMocks();
  });

  it('registers a single gh_issue subscriber on init', () => {
    expect(pollableRegistry.register).toHaveBeenCalledTimes(1);
    expect(pollableRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberKey: 'gh_issue' }),
    );
  });

  it('unregisters gh_issue subscriber on destroy', () => {
    service.onModuleDestroy();
    expect(pollableRegistry.unregister).toHaveBeenCalledWith('gh_issue');
  });

  describe('handleWebhook()', () => {
    it('throws UnauthorizedException when rawBody is undefined', () => {
      expect(() =>
        service.handleWebhook(undefined, 'sha256=valid', 'issues'),
      ).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when signature is invalid', () => {
      (signatureService.verify as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );

      expect(() =>
        service.handleWebhook(Buffer.from('{}'), 'sha256=invalid', 'issues'),
      ).toThrow(UnauthorizedException);
    });

    it('returns silently when no event type header', () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);

      service.handleWebhook(Buffer.from('{}'), 'sha256=valid', undefined);

      expect(trigger.handleWebhookPayload).not.toHaveBeenCalled();
    });

    it('parses body and fires dispatch for valid request', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);

      const payload = createPayload();
      service.handleWebhook(
        Buffer.from(JSON.stringify(payload)),
        'sha256=valid',
        'issues',
      );

      await vi.waitFor(() => {
        expect(trigger.handleWebhookPayload).toHaveBeenCalledWith(payload);
      });
    });
  });

  describe('dispatch()', () => {
    it('dispatches issues event directly to registered triggers', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);

      const payload = createPayload();
      await service.dispatch('issues', payload);

      expect(trigger.handleWebhookPayload).toHaveBeenCalledWith(payload);
    });

    it('ignores non-issues event types', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);

      await service.dispatch('pull_request', createPayload());

      expect(trigger.handleWebhookPayload).not.toHaveBeenCalled();
    });

    it('ignores unsupported issue actions', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);

      await service.dispatch('issues', createPayload({ action: 'closed' }));

      expect(trigger.handleWebhookPayload).not.toHaveBeenCalled();
    });

    it('fan-out: two triggers registered for same installation, both fire on dispatch', async () => {
      const trigger1 = createMockTrigger();
      const trigger2 = createMockTrigger();

      service.register('t1', trigger1, 1, ['owner/repo']);
      service.register('t2', trigger2, 1, ['owner/repo']);

      const payload = createPayload();
      await service.dispatch('issues', payload);

      expect(trigger1.handleWebhookPayload).toHaveBeenCalledWith(payload);
      expect(trigger2.handleWebhookPayload).toHaveBeenCalledWith(payload);
    });

    it('does not dispatch to unregistered triggers', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, 1, ['owner/repo']);
      service.unregister('t1');

      await service.dispatch('issues', createPayload());

      expect(trigger.handleWebhookPayload).not.toHaveBeenCalled();
    });

    it('logs errors from individual triggers without throwing', async () => {
      const failingTrigger = {
        handleWebhookPayload: vi
          .fn()
          .mockRejectedValue(new Error('trigger failed')),
        getWatchedRepoFullNames: vi.fn().mockReturnValue(['owner/repo']),
      };
      const successTrigger = createMockTrigger();

      service.register('t1', failingTrigger, 1, ['owner/repo']);
      service.register('t2', successTrigger, 1, ['owner/repo']);

      await service.dispatch('issues', createPayload());

      expect(successTrigger.handleWebhookPayload).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('t1'));
    });
  });

  it('does not register additional pollable subscribers when triggers are added', () => {
    const trigger = createMockTrigger();
    // onModuleInit already called register once
    service.register('t1', trigger, 42, ['owner/repo']);
    service.register('t2', trigger, 99, ['other/repo']);

    // Should still be just the one call from onModuleInit
    expect(pollableRegistry.register).toHaveBeenCalledTimes(1);
  });

  it('does not unregister pollable subscriber when individual triggers are removed', () => {
    const trigger = createMockTrigger();
    service.register('t1', trigger, 42, ['owner/repo']);
    service.unregister('t1');

    // unregister is only called by onModuleDestroy, not by trigger removal
    expect(pollableRegistry.unregister).not.toHaveBeenCalled();
  });

  it('dispatches issues event with any action in supported set', async () => {
    const trigger = createMockTrigger();
    service.register('t1', trigger, 1, ['owner/repo']);

    for (const action of ['opened', 'reopened', 'labeled', 'edited']) {
      await service.dispatch('issues', createPayload({ action }));
    }

    expect(trigger.handleWebhookPayload).toHaveBeenCalledTimes(4);
  });

  describe('pollAllInstallations() via registered pollFn', () => {
    function getRegisteredPollFn(): (
      since: Date,
    ) => Promise<GitHubIssuePayload[]> {
      const registerCall = (
        pollableRegistry.register as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0] as {
        pollFn: (since: Date) => Promise<GitHubIssuePayload[]>;
      };
      return registerCall.pollFn;
    }

    function createIssueNode(
      overrides: Partial<GitHubIssueNode> = {},
    ): GitHubIssueNode {
      return {
        id: 'I_1',
        number: 1,
        title: 'Test issue',
        body: null,
        url: 'https://github.com/owner/repo/issues/1',
        state: 'OPEN',
        createdAt: '2025-06-01T00:00:00Z',
        updatedAt: '2025-06-01T01:00:00Z',
        author: { login: 'alice' },
        labels: { nodes: [] },
        repository: {
          nameWithOwner: 'owner/repo',
          name: 'repo',
          owner: { login: 'owner' },
        },
        ...overrides,
      };
    }

    function mockFetchWithGraphQLResponse(
      nodes: GitHubIssueNode[],
      rateLimit = { remaining: 1000, resetAt: '2025-06-01T02:00:00Z' },
      repo = {
        nameWithOwner: 'owner/repo',
        name: 'repo',
        owner: { login: 'owner' },
      },
    ): void {
      const responseBody: GitHubIssueListResponse = {
        data: {
          repository: {
            issues: { nodes },
            ...repo,
          },
          rateLimit,
        },
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(responseBody),
      } as unknown as Response);
    }

    it('returns empty array when no triggers are registered', async () => {
      const pollFn = getRegisteredPollFn();
      const results = await pollFn(new Date('2025-06-01T00:00:00Z'));
      expect(results).toHaveLength(0);
    });

    it('returns empty array when all triggers have null installationId', async () => {
      const trigger = createMockTrigger();
      service.register('t1', trigger, null, ['owner/repo']);

      const pollFn = getRegisteredPollFn();
      const results = await pollFn(new Date('2025-06-01T00:00:00Z'));
      expect(results).toHaveLength(0);
    });

    it('maps returned issues to payloads', async () => {
      const node = createIssueNode({
        id: 'I_open',
        number: 10,
        title: 'Open issue',
        state: 'OPEN',
      });

      mockFetchWithGraphQLResponse([node]);
      (
        gitHubAppService.getInstallationToken as ReturnType<typeof vi.fn>
      ).mockResolvedValue('fake-token');

      const trigger = createMockTrigger();
      service.register('t1', trigger, 99, ['owner/repo']);

      const pollFn = getRegisteredPollFn();
      const since = new Date('2025-06-01T00:00:00Z');
      const results = await pollFn(since);

      expect(results).toHaveLength(1);
      expect(results[0]!.issue.number).toBe(10);
      expect(results[0]!.issue.title).toBe('Open issue');
    });

    it('throws when GraphQL response contains errors and no data', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          errors: [{ message: 'Bad query' }],
        }),
      } as unknown as Response);

      (
        gitHubAppService.getInstallationToken as ReturnType<typeof vi.fn>
      ).mockResolvedValue('fake-token');

      const trigger = createMockTrigger();
      service.register('t1', trigger, 99, ['owner/repo']);

      const pollFn = getRegisteredPollFn();
      const since = new Date('2025-06-01T00:00:00Z');
      await expect(pollFn(since)).rejects.toThrow(
        'GitHub GraphQL response contained errors',
      );
    });

    it('returns fetched data even when rate limit is low', async () => {
      const node = createIssueNode({ id: 'I_low_rate', number: 5 });

      mockFetchWithGraphQLResponse([node], {
        remaining: 10,
        resetAt: '2025-06-01T02:00:00Z',
      });

      (
        gitHubAppService.getInstallationToken as ReturnType<typeof vi.fn>
      ).mockResolvedValue('fake-token');

      const trigger = createMockTrigger();
      service.register('t1', trigger, 99, ['owner/repo']);

      const pollFn = getRegisteredPollFn();
      const since = new Date('2025-06-01T00:00:00Z');
      const results = await pollFn(since);

      expect(results).toHaveLength(1);
      expect(results[0]!.issue.number).toBe(5);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('GitHub rate limit low'),
      );
    });

    it('aggregates issues from multiple installations', async () => {
      const nodeA = createIssueNode({
        id: 'I_A',
        number: 1,
        title: 'Repo A issue',
      });
      const nodeB = createIssueNode({
        id: 'I_B',
        number: 2,
        title: 'Repo B issue',
      });

      (
        gitHubAppService.getInstallationToken as ReturnType<typeof vi.fn>
      ).mockResolvedValue('fake-token');

      const repos = [
        {
          nameWithOwner: 'owner/repo',
          name: 'repo',
          owner: { login: 'owner' },
        },
        {
          nameWithOwner: 'org/repo-b',
          name: 'repo-b',
          owner: { login: 'org' },
        },
      ];

      let fetchCallCount = 0;
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        const idx = fetchCallCount++;
        const node = idx === 0 ? nodeA : nodeB;
        const repo = repos[idx]!;
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: {
              repository: {
                issues: { nodes: [node] },
                ...repo,
              },
              rateLimit: { remaining: 1000, resetAt: '2025-06-01T02:00:00Z' },
            },
          }),
        } as unknown as Response;
      });

      service.register('t1', createMockTrigger(), 1, ['owner/repo']);
      service.register('t2', createMockTrigger(), 2, ['org/repo-b']);

      const pollFn = getRegisteredPollFn();
      const results = await pollFn(new Date('2025-06-01T00:00:00Z'));

      expect(results).toHaveLength(2);
    });
  });

  describe('mapNodeToPayload()', () => {
    it('maps a GraphQL node with createdAt !== updatedAt to Edited action', () => {
      const node = {
        id: 'I_1',
        number: 42,
        title: 'Feature request',
        body: 'Please add this',
        url: 'https://github.com/org/project/issues/42',
        state: 'OPEN',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T01:00:00Z',
        author: { login: 'alice' },
        labels: { nodes: [{ name: 'enhancement' }, { name: 'p1' }] },
        repository: {
          nameWithOwner: 'org/project',
          name: 'project',
          owner: { login: 'org' },
        },
      };

      const payload = (
        service as never as {
          mapNodeToPayload: (node: unknown) => GitHubIssuePayload;
        }
      ).mapNodeToPayload(node);

      expect(payload).toEqual({
        action: GitHubIssueAction.Edited,
        issue: {
          number: 42,
          title: 'Feature request',
          body: 'Please add this',
          html_url: 'https://github.com/org/project/issues/42',
          updated_at: '2025-01-01T01:00:00Z',
          labels: [{ name: 'enhancement' }, { name: 'p1' }],
          user: { login: 'alice' },
        },
        repository: {
          full_name: 'org/project',
          owner: { login: 'org' },
          name: 'project',
        },
      });
    });

    it('maps a GraphQL node with createdAt === updatedAt to Opened action', () => {
      const node = {
        id: 'I_2',
        number: 1,
        title: 'New issue',
        body: null,
        url: 'https://github.com/org/project/issues/1',
        state: 'OPEN',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        author: { login: 'bob' },
        labels: { nodes: [] },
        repository: {
          nameWithOwner: 'org/project',
          name: 'project',
          owner: { login: 'org' },
        },
      };

      const payload = (
        service as never as {
          mapNodeToPayload: (node: unknown) => GitHubIssuePayload;
        }
      ).mapNodeToPayload(node);

      expect(payload.action).toBe(GitHubIssueAction.Opened);
      expect(payload.issue.updated_at).toBe('2025-01-01T00:00:00Z');
    });

    it('falls back to "unknown" login when author is null', () => {
      const node = {
        id: 'I_3',
        number: 1,
        title: 'Ghost issue',
        body: null,
        url: 'https://github.com/org/project/issues/1',
        state: 'OPEN',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        author: null,
        labels: { nodes: [] },
        repository: {
          nameWithOwner: 'org/project',
          name: 'project',
          owner: { login: 'org' },
        },
      };

      const payload = (
        service as never as {
          mapNodeToPayload: (node: unknown) => GitHubIssuePayload;
        }
      ).mapNodeToPayload(node);

      expect(payload.issue.user.login).toBe('unknown');
    });
  });
});
