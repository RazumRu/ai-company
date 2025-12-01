import { Injectable } from '@nestjs/common';

import { LiteLlmModelDto } from '../dto/models.dto';
import { LiteLlmClient } from './litellm.client';

@Injectable()
export class LitellmService {
  constructor(private readonly liteLlmClient: LiteLlmClient) {}

  async listModels(): Promise<LiteLlmModelDto[]> {
    const response = await this.liteLlmClient.listModels();

    return response.map((m) => ({
      id: m.id,
      ownedBy: m.owned_by,
    }));
  }
}
