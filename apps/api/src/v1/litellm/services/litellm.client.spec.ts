import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiteLlmClient } from './litellm.client';

vi.mock('../../../environments', () => ({
  environment: {
    llmBaseUrl: 'http://litellm:4000',
    litellmMasterKey: 'test-master-key',
  },
}));

function stubFetch(response: Partial<Response>) {
  const defaults: Response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response;

  const merged = { ...defaults, ...response };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(merged as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('LiteLlmClient', () => {
  let client: LiteLlmClient;

  beforeEach(() => {
    client = new LiteLlmClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('request (via listModels)', () => {
    it('rejects with an error containing status code on non-ok response', async () => {
      stubFetch({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('upstream error details'),
      });

      await expect(client.listModels()).rejects.toThrow(
        'LiteLLM request failed: 500 Internal Server Error - upstream error details',
      );
    });

    it('includes response body in error message when available', async () => {
      stubFetch({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: vi.fn().mockResolvedValue(''),
      });

      await expect(client.listModels()).rejects.toThrow(
        'LiteLLM request failed: 502 Bad Gateway',
      );
    });

    it('handles text() failure gracefully in error path', async () => {
      stubFetch({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: vi.fn().mockRejectedValue(new Error('read failed')),
      });

      await expect(client.listModels()).rejects.toThrow(
        'LiteLLM request failed: 503 Service Unavailable',
      );
    });

    it('returns parsed JSON data on successful response', async () => {
      const modelData = [
        { id: 'gpt-4', object: 'model', created: 1000, owned_by: 'openai' },
        { id: 'claude-3', object: 'model', created: 2000, owned_by: 'anthropic' },
      ];

      stubFetch({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ data: modelData }),
      });

      const result = await client.listModels();

      expect(result).toEqual(modelData);
    });

    it('sends Authorization header with bearer token', async () => {
      const fetchMock = stubFetch({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });

      await client.listModels();

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = fetchMock.mock.calls[0]!;
      expect(call[0]).toBe('http://litellm:4000/v1/models');
      expect(call[1]).toBeDefined();
      expect((call[1] as RequestInit).headers).toEqual(
        expect.objectContaining({
          Authorization: 'Bearer test-master-key',
        }),
      );
    });

    it('includes AbortSignal timeout in fetch options', async () => {
      const fetchMock = stubFetch({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });

      await client.listModels();

      const call = fetchMock.mock.calls[0]!;
      expect((call[1] as RequestInit).signal).toBeDefined();
    });
  });

  describe('getModelInfo', () => {
    it('returns matching model info', async () => {
      const modelInfo = {
        model_name: 'gpt-4',
        litellm_params: { model: 'openai/gpt-4' },
        model_info: { key: 'gpt-4' },
      };

      stubFetch({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [modelInfo] }),
      });

      const result = await client.getModelInfo('gpt-4');

      expect(result).toEqual(modelInfo);
    });

    it('returns null when model is not found', async () => {
      stubFetch({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });

      const result = await client.getModelInfo('nonexistent');

      expect(result).toBeNull();
    });
  });
});
