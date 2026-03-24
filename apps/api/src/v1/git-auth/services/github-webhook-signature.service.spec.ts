import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubWebhookSignatureService } from './github-webhook-signature.service';

const TEST_SECRET = 'test-webhook-secret';

const mockEnvironment: Record<string, unknown> = {
  githubWebhookSecret: TEST_SECRET,
};

vi.mock('../../../environments', () => ({
  get environment() {
    return mockEnvironment;
  },
}));

function sign(body: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

describe('GitHubWebhookSignatureService', () => {
  let service: GitHubWebhookSignatureService;

  beforeEach(() => {
    mockEnvironment.githubWebhookSecret = TEST_SECRET;
    service = new GitHubWebhookSignatureService();
  });

  it('returns true for a valid signature', () => {
    const body = Buffer.from('{"action":"opened"}');
    const signature = sign(body, TEST_SECRET);

    expect(service.verify(body, signature)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const body = Buffer.from('{"action":"opened"}');
    const signature = sign(Buffer.from('different-body'), TEST_SECRET);

    expect(service.verify(body, signature)).toBe(false);
  });

  it('returns false when signature header is missing', () => {
    const body = Buffer.from('{"action":"opened"}');

    expect(service.verify(body, undefined)).toBe(false);
  });

  it('returns false when secret is empty', () => {
    mockEnvironment.githubWebhookSecret = '';

    const body = Buffer.from('{"action":"opened"}');
    const signature = sign(body, '');

    expect(service.verify(body, signature)).toBe(false);
  });

  it('returns false for different-length buffers without throwing', () => {
    const body = Buffer.from('{"action":"opened"}');
    const signature = 'sha256=abc';

    expect(service.verify(body, signature)).toBe(false);
  });

  it('returns false when signature header lacks sha256= prefix', () => {
    const body = Buffer.from('{"action":"opened"}');
    const hmac = createHmac('sha256', TEST_SECRET).update(body).digest('hex');

    expect(service.verify(body, hmac)).toBe(false);
  });
});
