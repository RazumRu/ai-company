import { INestApplication } from '@nestjs/common';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import type { LiteLLMModelInfo } from '../../../v1/litellm/litellm.types';
import { LiteLlmClient } from '../../../v1/litellm/services/litellm.client';
import { LiteLlmAdminService } from '../../../v1/litellm/services/litellm-admin.service';
import { createTestModule } from '../../integration/setup';

describe('LiteLlmAdminService (integration)', () => {
  let app: INestApplication;
  let adminService: LiteLlmAdminService;

  const mockModels: LiteLLMModelInfo[] = [
    {
      model_name: 'gpt-4o',
      litellm_params: {
        model: 'openai/gpt-4o',
        api_base: 'https://api.openai.com',
        custom_llm_provider: 'openai',
      },
      model_info: {
        id: 'db-id-1',
        key: 'gpt-4o',
        supports_function_calling: true,
        supports_native_streaming: true,
        supports_reasoning: false,
      },
    },
    {
      model_name: 'claude-3',
      litellm_params: {
        model: 'anthropic/claude-3-opus',
      },
      model_info: {
        id: 'db-id-2',
        key: 'claude-3',
        supports_reasoning: true,
      },
    },
    {
      model_name: 'no-id-model',
      litellm_params: { model: 'openai/gpt-3.5' },
      model_info: { key: 'gpt-3.5' },
    },
    {
      model_name: 'null-info-model',
      litellm_params: { model: 'openai/gpt-3' },
      model_info: null,
    },
  ];

  let createModelMock: Mock;
  let updateModelMock: Mock;
  let deleteModelMock: Mock;
  let testModelMock: Mock;
  let invalidateCacheMock: Mock;

  beforeAll(async () => {
    createModelMock = vi.fn().mockResolvedValue({});
    updateModelMock = vi.fn().mockResolvedValue({});
    deleteModelMock = vi.fn().mockResolvedValue({});
    testModelMock = vi
      .fn()
      .mockResolvedValue({ success: true, latencyMs: 100 });
    invalidateCacheMock = vi.fn();

    app = await createTestModule(async (moduleBuilder) =>
      moduleBuilder
        .overrideProvider(LiteLlmClient)
        .useValue({
          fetchModelList: async () => mockModels,
          getModelInfo: async (model: string) =>
            mockModels.find((m) => m.model_name === model) ?? null,
          createModel: createModelMock,
          updateModel: updateModelMock,
          deleteModel: deleteModelMock,
          testModel: testModelMock,
          invalidateCache: invalidateCacheMock,
        })
        .compile(),
    );

    adminService = app.get(LiteLlmAdminService);
  });

  afterAll(async () => {
    const suppressRedisClose = (reason: unknown) => {
      if (
        reason instanceof Error &&
        reason.message === 'Connection is closed.'
      ) {
        return;
      }
      throw reason;
    };
    process.on('unhandledRejection', suppressRedisClose);

    await app.close();

    process.removeListener('unhandledRejection', suppressRedisClose);
  });

  describe('listModelsInfo', () => {
    it('returns models with id, filtering out those without model_info.id', async () => {
      const result = await adminService.listModelsInfo();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'db-id-1',
        modelName: 'gpt-4o',
        providerModel: 'openai/gpt-4o',
        apiBase: 'https://api.openai.com',
        customLlmProvider: 'openai',
        supportsToolCalling: true,
        supportsStreaming: true,
        supportsReasoning: false,
      });
      expect(result[1]).toEqual({
        id: 'db-id-2',
        modelName: 'claude-3',
        providerModel: 'anthropic/claude-3-opus',
        apiBase: undefined,
        customLlmProvider: undefined,
        supportsToolCalling: undefined,
        supportsStreaming: undefined,
        supportsReasoning: true,
      });
    });
  });

  describe('createModel', () => {
    it('creates a model with snake_case payload and invalidates cache', async () => {
      await adminService.createModel({
        modelName: 'new-model',
        litellmParams: {
          model: 'openai/gpt-4o-mini',
          apiBase: 'https://custom.api.com',
        },
      });

      expect(createModelMock).toHaveBeenCalledWith({
        model_name: 'new-model',
        litellm_params: {
          model: 'openai/gpt-4o-mini',
          api_base: 'https://custom.api.com',
        },
      });
      expect(invalidateCacheMock).toHaveBeenCalled();
    });
  });

  describe('deleteModel', () => {
    it('deletes a model by id and invalidates cache', async () => {
      await adminService.deleteModel('db-id-1');

      expect(deleteModelMock).toHaveBeenCalledWith('db-id-1');
      expect(invalidateCacheMock).toHaveBeenCalled();
    });
  });

  describe('testModel', () => {
    it('returns test result from the client', async () => {
      const result = await adminService.testModel('gpt-4o');

      expect(result).toEqual({ success: true, latencyMs: 100 });
    });
  });
});
