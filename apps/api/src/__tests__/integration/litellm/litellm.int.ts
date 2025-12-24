import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LiteLlmClient } from '../../../v1/litellm/services/litellm.client';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { createTestModule } from '../../integration/setup';

describe('LiteLLM (integration)', () => {
  let app: INestApplication;
  let modelsService: LitellmService;

  const mockResponse = [
    {
      id: 'gpt-5.1',
      object: 'model',
      created: 1677610602,
      owned_by: 'openai',
    },
  ];

  beforeAll(async () => {
    app = await createTestModule(async (moduleBuilder) =>
      moduleBuilder
        .overrideProvider(LiteLlmClient)
        .useValue({
          listModels: async () => mockResponse,
        })
        .compile(),
    );

    modelsService = app.get(LitellmService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns models from LiteLLM client', async () => {
    const result = await modelsService.listModels();
    expect(result).toEqual([{ id: 'gpt-5.1', ownedBy: 'openai' }]);
  });
});
