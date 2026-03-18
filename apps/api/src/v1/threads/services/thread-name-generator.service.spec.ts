import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { OpenaiService } from '../../openai/openai.service';
import { ThreadNameGeneratorService } from './thread-name-generator.service';

describe('ThreadNameGeneratorService', () => {
  let service: ThreadNameGeneratorService;
  let openaiService: { jsonRequest: ReturnType<typeof vi.fn> };
  let llmModelsService: { getThreadNameModel: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };

  const mockModel = 'gpt-5-mini';

  beforeEach(async () => {
    openaiService = {
      jsonRequest: vi.fn(),
    };

    llmModelsService = {
      getThreadNameModel: vi.fn().mockReturnValue(mockModel),
    };

    logger = {
      error: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadNameGeneratorService,
        { provide: OpenaiService, useValue: openaiService },
        { provide: LlmModelsService, useValue: llmModelsService },
        { provide: DefaultLogger, useValue: logger },
      ],
    }).compile();

    service = module.get<ThreadNameGeneratorService>(
      ThreadNameGeneratorService,
    );
  });

  describe('generateFromFirstUserMessage', () => {
    it('should return generated title from LLM response', async () => {
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: 'My Conversation Title' },
      });

      const result = await service.generateFromFirstUserMessage(
        'Hello, how are you?',
      );

      expect(result).toBe('My Conversation Title');
      expect(openaiService.jsonRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockModel,
          maxOutputTokens: 1024,
        }),
      );
    });

    it('should return undefined for empty input', async () => {
      const result = await service.generateFromFirstUserMessage('');
      expect(result).toBeUndefined();
      expect(openaiService.jsonRequest).not.toHaveBeenCalled();
    });

    it('should return undefined for whitespace-only input', async () => {
      const result = await service.generateFromFirstUserMessage('   \n\t  ');
      expect(result).toBeUndefined();
      expect(openaiService.jsonRequest).not.toHaveBeenCalled();
    });

    it('should normalize whitespace in input before sending to LLM', async () => {
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: 'Normalized Title' },
      });

      await service.generateFromFirstUserMessage('  Hello   world  \n  test  ');

      expect(openaiService.jsonRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Generate a concise title for this conversation based on the first user message:\n\nHello world test`,
        }),
      );
    });

    it('should return fallback (first 100 chars) when LLM returns empty content', async () => {
      openaiService.jsonRequest.mockResolvedValue({ content: undefined });

      const input = 'This is a test message for fallback';
      const result = await service.generateFromFirstUserMessage(input);

      expect(result).toBe(input);
      expect(logger.error).toHaveBeenCalledWith(
        'Thread name LLM response returned no content',
      );
    });

    it('should return fallback when LLM returns null content', async () => {
      openaiService.jsonRequest.mockResolvedValue({ content: null });

      const input = 'Test message for null content';
      const result = await service.generateFromFirstUserMessage(input);

      expect(result).toBe(input);
      expect(logger.error).toHaveBeenCalledWith(
        'Thread name LLM response returned no content',
      );
    });

    it('should return fallback when LLM response fails schema validation', async () => {
      openaiService.jsonRequest.mockResolvedValue({
        content: { notTitle: 'wrong schema' },
      });

      const input = 'Some user message';
      const result = await service.generateFromFirstUserMessage(input);

      expect(result).toBe(input);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Thread name parse failed'),
      );
    });

    it('should return fallback when LLM returns title with empty string', async () => {
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: '' },
      });

      const input = 'Some user message';
      const result = await service.generateFromFirstUserMessage(input);

      // Empty title fails zod min(1) validation, falls back
      expect(result).toBe(input);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Thread name parse failed'),
      );
    });

    it('should return fallback when jsonRequest throws', async () => {
      openaiService.jsonRequest.mockRejectedValue(new Error('LLM error'));

      const input = 'Some user message';
      const result = await service.generateFromFirstUserMessage(input);

      expect(result).toBe(input);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Thread name LLM call failed: LLM error'),
      );
    });

    it('should return fallback when LLM times out', async () => {
      vi.useFakeTimers();

      openaiService.jsonRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ content: { title: 'Late' } }), 60000);
          }),
      );

      const input = 'Test timeout message';
      const resultPromise = service.generateFromFirstUserMessage(input);

      // Advance past the 30s internal timeout
      await vi.advanceTimersByTimeAsync(30001);

      const result = await resultPromise;
      expect(result).toBe(input);

      vi.useRealTimers();
    });

    it('should truncate long titles to 100 characters', async () => {
      const longTitle = 'A'.repeat(200);
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: longTitle },
      });

      const result = await service.generateFromFirstUserMessage('test');

      // The title passes min(1) safeParse, then gets sliced to 100 by the service
      expect(result).toBe('A'.repeat(100));
    });

    it('should truncate fallback to 100 characters for long input', async () => {
      openaiService.jsonRequest.mockResolvedValue({ content: undefined });

      const longInput = 'X'.repeat(200);
      const result = await service.generateFromFirstUserMessage(longInput);

      expect(result).toBe('X'.repeat(100));
    });

    it('should trim whitespace from generated title', async () => {
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: '  Trimmed Title  ' },
      });

      const result = await service.generateFromFirstUserMessage('test message');

      expect(result).toBe('Trimmed Title');
    });

    it('should use model from llmModelsService', async () => {
      llmModelsService.getThreadNameModel.mockReturnValue('custom-model');
      openaiService.jsonRequest.mockResolvedValue({
        content: { title: 'Title' },
      });

      await service.generateFromFirstUserMessage('test');

      expect(openaiService.jsonRequest).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-model' }),
      );
    });

    it('should log error when outer try-catch catches an unexpected error', async () => {
      // Force a sync throw that gets caught by the outer try-catch
      llmModelsService.getThreadNameModel.mockImplementation(() => {
        throw new Error('Unexpected model error');
      });

      const result = await service.generateFromFirstUserMessage('test message');

      expect(result).toBe('test message');
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        expect.stringContaining('thread-name-generator.error'),
      );
    });
  });
});
