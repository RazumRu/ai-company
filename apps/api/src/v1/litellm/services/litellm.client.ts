import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

import { environment } from '../../../environments';
import { LiteLLMModelInfo } from '../litellm.types';

@Injectable()
export class LiteLlmClient {
  private async request<T>(path: string, params?: AxiosRequestConfig) {
    return axios.request<T>({
      url: `${environment.llmBaseUrl}${path}`,
      headers: {
        Authorization: `Bearer ${environment.litellmMasterKey}`,
      },
      ...params,
    });
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

    return response.data.data;
  }

  async getModelInfo(model: string): Promise<LiteLLMModelInfo | null> {
    const response = await this.request<{ data: LiteLLMModelInfo[] }>(
      '/v1/model/info',
    );

    const models = Array.isArray(response.data.data) ? response.data.data : [];

    const match = models.find((m) => m.model_name === model);
    if (!match || !match.model_name) {
      return null;
    }

    return match;
  }
}
