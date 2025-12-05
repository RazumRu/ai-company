import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

import { environment } from '../../../environments';

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
}
