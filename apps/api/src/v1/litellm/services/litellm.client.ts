import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';
import { LiteLLMModelInfo } from '../litellm.types';

@Injectable()
export class LiteLlmClient {
  private static readonly MODEL_LIST_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  private modelListCache: {
    expiresAt: number;
    data: LiteLLMModelInfo[];
  } | null = null;
  private modelListInFlight: Promise<LiteLLMModelInfo[]> | null = null;

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${environment.llmBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${environment.litellmMasterKey}`,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `LiteLLM request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async listModels() {
    const response = await this.request<{
      data: {
        id: string;
        object: string;
        created: number;
        owned_by: string;
      }[];
    }>('/v1/models');

    return response.data;
  }

  async getModelInfo(model: string): Promise<LiteLLMModelInfo | null> {
    const models = await this.fetchModelList();
    const match = models.find((m) => m.model_name === model);
    if (!match || !match.model_name) {
      return null;
    }

    return match;
  }

  /**
   * Fetches the full model info list from LiteLLM, with in-memory caching
   * and in-flight deduplication to avoid redundant HTTP requests.
   */
  private async fetchModelList(): Promise<LiteLLMModelInfo[]> {
    const now = Date.now();
    if (this.modelListCache && this.modelListCache.expiresAt > now) {
      return this.modelListCache.data;
    }

    if (this.modelListInFlight) {
      return this.modelListInFlight;
    }

    const promise = (async () => {
      const response = await this.request<{ data: LiteLLMModelInfo[] }>(
        '/v1/model/info',
      );
      const models = Array.isArray(response.data) ? response.data : [];
      this.modelListCache = {
        expiresAt: Date.now() + LiteLlmClient.MODEL_LIST_TTL_MS,
        data: models,
      };
      return models;
    })().finally(() => {
      this.modelListInFlight = null;
    });

    this.modelListInFlight = promise;
    return promise;
  }
}
