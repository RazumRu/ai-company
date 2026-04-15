import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LitellmService } from '../litellm/services/litellm.service';
import { OpenaiService } from './openai.service';

describe('OpenaiService — reasoning propagation', () => {
  let service: OpenaiService;
  let litellmService: {
    extractTokenUsageFromResponse: ReturnType<typeof vi.fn>;
    supportsResponsesApi: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    litellmService = {
      extractTokenUsageFromResponse: vi.fn().mockResolvedValue(undefined),
      supportsResponsesApi: vi.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenaiService,
        { provide: LitellmService, useValue: litellmService },
      ],
    }).compile();

    service = module.get<OpenaiService>(OpenaiService);
  });

  describe('complete()', () => {
    it('forwards reasoning.effort as reasoning_effort to the Chat Completions call', async () => {
      const spy = vi
        .spyOn(service['client'].chat.completions, 'create')
        .mockResolvedValue({
          id: 'chat-1',
          choices: [{ message: { content: 'hello' } }],
          usage: null,
        } as never);

      await service.complete({
        model: 'gpt-4o',
        message: 'test',
        reasoning: { effort: 'medium' },
      });

      expect(spy).toHaveBeenCalledOnce();
      const callArg = spy.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg['reasoning_effort']).toBe('medium');
    });

    it('omits reasoning_effort when data.reasoning is undefined', async () => {
      const spy = vi
        .spyOn(service['client'].chat.completions, 'create')
        .mockResolvedValue({
          id: 'chat-2',
          choices: [{ message: { content: 'hello' } }],
          usage: null,
        } as never);

      await service.complete({
        model: 'gpt-4o',
        message: 'test',
      });

      expect(spy).toHaveBeenCalledOnce();
      const callArg = spy.mock.calls[0][0] as Record<string, unknown>;
      expect(
        Object.prototype.hasOwnProperty.call(callArg, 'reasoning_effort'),
      ).toBe(false);
    });
  });

  describe('response()', () => {
    it('forwards reasoning to the Responses API call', async () => {
      const spy = vi
        .spyOn(service['client'].responses, 'create')
        .mockResolvedValue({
          id: 'resp-1',
          output_text: 'hello',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        } as never);

      await service.response({
        model: 'o3',
        message: 'test',
        reasoning: { effort: 'high' },
      });

      expect(spy).toHaveBeenCalledOnce();
      const callArg = spy.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg['reasoning']).toEqual({ effort: 'high' });
    });

    it('omits reasoning when data.reasoning is undefined', async () => {
      const spy = vi
        .spyOn(service['client'].responses, 'create')
        .mockResolvedValue({
          id: 'resp-2',
          output_text: 'hello',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        } as never);

      await service.response({
        model: 'o3',
        message: 'test',
      });

      expect(spy).toHaveBeenCalledOnce();
      const callArg = spy.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(callArg, 'reasoning')).toBe(
        false,
      );
    });
  });
});
