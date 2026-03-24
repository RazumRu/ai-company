import { describe, expect, it } from 'vitest';

import { GitHubIssuesTriggerTemplateSchema } from './github-issues-trigger.template';

describe('GitHubIssuesTriggerTemplateSchema', () => {
  it('accepts valid config with repositoryIds', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({
      repositoryIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with optional labels and titleRegexp', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({
      repositoryIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      labels: ['bug', 'enhancement'],
      titleRegexp: '^\\[BUG\\]',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labels).toEqual(['bug', 'enhancement']);
      expect(result.data.titleRegexp).toBe('^\\[BUG\\]');
    }
  });

  it('rejects empty repositoryIds array', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({
      repositoryIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing repositoryIds', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid repositoryIds', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({
      repositoryIds: ['not-a-uuid'],
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown fields', () => {
    const result = GitHubIssuesTriggerTemplateSchema.safeParse({
      repositoryIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      unknownField: 'value',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('unknownField' in result.data).toBe(false);
    }
  });
});
