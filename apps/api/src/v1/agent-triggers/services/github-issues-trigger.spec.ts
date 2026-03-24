import { HumanMessage } from '@langchain/core/messages';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubIssuePayload } from '../../git-auth/git-auth.types';
import { GitHubWebhookSubscriptionService } from '../../git-auth/services/webhook-subscription-registry.service';
import { TriggerStatus } from '../agent-triggers.types';
import { GitHubIssuesTrigger } from './github-issues-trigger';

function createPayload(
  overrides: Partial<GitHubIssuePayload> = {},
): GitHubIssuePayload {
  return {
    action: 'opened',
    issue: {
      number: 42,
      title: 'Test issue',
      body: 'Test body',
      html_url: 'https://github.com/owner/repo/issues/42',
      updated_at: '2025-01-01T00:00:00Z',
      labels: [],
      user: { login: 'testuser' },
    },
    repository: {
      full_name: 'owner/repo',
      owner: { login: 'owner' },
      name: 'repo',
    },
    ...overrides,
  };
}

function createMockRegistry(): GitHubWebhookSubscriptionService {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    dispatch: vi.fn(),
  } as unknown as GitHubWebhookSubscriptionService;
}

function createMockLogger(): DefaultLogger {
  return {
    log: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  } as unknown as DefaultLogger;
}

describe('GitHubIssuesTrigger', () => {
  let trigger: GitHubIssuesTrigger;
  let registry: GitHubWebhookSubscriptionService;
  let logger: DefaultLogger;

  beforeEach(() => {
    logger = createMockLogger();
    registry = createMockRegistry();
    trigger = new GitHubIssuesTrigger(logger);
    trigger.initialize(
      'graph1:node1',
      {
        repositoryIds: ['uuid-1'],
        watchedRepoFullNames: ['owner/repo'],
      },
      registry,
      12345,
    );
  });

  describe('start/stop', () => {
    it('sets status to LISTENING and registers with the registry', async () => {
      await trigger.start();

      expect(trigger.getStatus()).toBe(TriggerStatus.LISTENING);
      expect(registry.register).toHaveBeenCalledWith(
        'graph1:node1',
        trigger,
        12345,
        ['owner/repo'],
      );
    });

    it('sets status to DESTROYED and unregisters on stop', async () => {
      await trigger.start();
      await trigger.stop();

      expect(trigger.getStatus()).toBe(TriggerStatus.DESTROYED);
      expect(registry.unregister).toHaveBeenCalledWith('graph1:node1');
    });
  });

  describe('handleWebhookPayload', () => {
    it('fires the agent for a matching payload', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload();
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).toHaveBeenCalledTimes(1);
      const messages = invokeAgent.mock.calls[0]![0] as HumanMessage[];
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toContain('owner/repo');
      expect(messages[0]!.content).toContain('#42');
    });

    it('drops payload when repo is not watched', async () => {
      const invokeAgent = vi.fn();
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        repository: {
          full_name: 'other/repo',
          owner: { login: 'other' },
          name: 'repo',
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
    });

    it('returns silently when trigger is not started', async () => {
      const invokeAgent = vi.fn();
      trigger.setInvokeAgent(invokeAgent);

      const payload = createPayload();
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
    });
  });

  describe('label filtering', () => {
    beforeEach(() => {
      trigger = new GitHubIssuesTrigger(logger);
      trigger.initialize(
        'graph1:node1',
        {
          repositoryIds: ['uuid-1'],
          watchedRepoFullNames: ['owner/repo'],
          labels: ['bug'],
        },
        registry,
        12345,
      );
    });

    it('matches when issue has a configured label', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 1,
          title: 'A bug',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'bug' }, { name: 'enhancement' }],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).toHaveBeenCalledTimes(1);
    });

    it('drops when issue has no matching label', async () => {
      const invokeAgent = vi.fn();
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 1,
          title: 'A feature',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'enhancement' }],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
    });

    it('for labeled action, checks only payload.label.name', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      // The issue has the "bug" label in its labels array, but the
      // newly added label is "enhancement" — should NOT match
      const payload = createPayload({
        action: 'labeled',
        label: { name: 'enhancement' },
        issue: {
          number: 1,
          title: 'Test',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'bug' }, { name: 'enhancement' }],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
    });

    it('for labeled action, matches when payload.label.name matches config', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        action: 'labeled',
        label: { name: 'bug' },
        issue: {
          number: 1,
          title: 'Test',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'bug' }],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('title regexp filtering', () => {
    beforeEach(() => {
      trigger = new GitHubIssuesTrigger(logger);
      trigger.initialize(
        'graph1:node1',
        {
          repositoryIds: ['uuid-1'],
          watchedRepoFullNames: ['owner/repo'],
          titleRegexp: '^\\[BUG\\]',
        },
        registry,
        12345,
      );
    });

    it('matches when title matches the regexp', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 1,
          title: '[BUG] Something broke',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).toHaveBeenCalledTimes(1);
    });

    it('drops when title does not match the regexp', async () => {
      const invokeAgent = vi.fn();
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 1,
          title: 'Feature request',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [],
          user: { login: 'user' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
    });

    it('does not throw on invalid regexp, returns false', async () => {
      trigger = new GitHubIssuesTrigger(logger);
      trigger.initialize(
        'graph1:node1',
        {
          repositoryIds: ['uuid-1'],
          watchedRepoFullNames: ['owner/repo'],
          titleRegexp: '[invalid',
        },
        registry,
        12345,
      );

      const invokeAgent = vi.fn();
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload();
      await trigger.handleWebhookPayload(payload);

      expect(invokeAgent).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('convertPayloadToMessages', () => {
    it('formats payload into a structured human message', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 7,
          title: 'Bug report',
          body: 'Steps to reproduce...',
          html_url: 'https://github.com/owner/repo/issues/7',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [{ name: 'bug' }, { name: 'urgent' }],
          user: { login: 'alice' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      const messages = invokeAgent.mock.calls[0]![0] as HumanMessage[];
      const content = messages[0]!.content as string;

      expect(content).toContain('A GitHub issue was opened on owner/repo.');
      expect(content).toContain('**Issue #7: Bug report**');
      expect(content).toContain('Author: alice');
      expect(content).toContain('Labels: bug, urgent');
      expect(content).toContain('Steps to reproduce...');
    });

    it('uses "(no description)" when body is null', async () => {
      const invokeAgent = vi.fn().mockResolvedValue({
        messages: [],
        threadId: 't1',
        checkpointNs: 'c1',
      });
      trigger.setInvokeAgent(invokeAgent);
      await trigger.start();

      const payload = createPayload({
        issue: {
          number: 1,
          title: 'No body',
          body: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2025-01-01T00:00:00Z',
          labels: [],
          user: { login: 'bob' },
        },
      });
      await trigger.handleWebhookPayload(payload);

      const messages = invokeAgent.mock.calls[0]![0] as HumanMessage[];
      const content = messages[0]!.content as string;
      expect(content).toContain('(no description)');
    });
  });
});
