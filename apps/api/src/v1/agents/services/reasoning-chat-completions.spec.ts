import { AIMessage } from '@langchain/core/messages';
import { OpenAIClient } from '@langchain/openai';
import { describe, expect, it } from 'vitest';

import { ReasoningAwareChatCompletions } from './reasoning-chat-completions';

type ResponseMetadataWithProvider = Record<string, unknown> & {
  model_provider?: string;
};

describe('ReasoningAwareChatCompletions', () => {
  const instance = new ReasoningAwareChatCompletions({});

  describe('_convertCompletionsMessageToBaseMessage', () => {
    const baseResponse: OpenAIClient.ChatCompletion = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'answer', refusal: null },
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
    };

    it('should pass through when no reasoning_content is present', () => {
      const message: OpenAIClient.ChatCompletionMessage = {
        role: 'assistant',
        content: 'hello',
        refusal: null,
      };

      const result = instance._convertCompletionsMessageToBaseMessage(
        message,
        baseResponse,
      );

      expect(result).toBeInstanceOf(AIMessage);
      expect(result.additional_kwargs.reasoning_content).toBeUndefined();
    });

    it('should inject reasoning_content from top-level field', () => {
      const message = {
        role: 'assistant',
        content: 'answer',
        refusal: null,
        reasoning_content: 'Let me think step by step...',
      } as OpenAIClient.ChatCompletionMessage & {
        reasoning_content: string;
      };

      const result = instance._convertCompletionsMessageToBaseMessage(
        message as unknown as OpenAIClient.ChatCompletionMessage,
        baseResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBe(
        'Let me think step by step...',
      );
      expect(
        (result.response_metadata as ResponseMetadataWithProvider)
          ?.model_provider,
      ).toBe('deepseek');
    });

    it('should inject reasoning_content from provider_specific_fields', () => {
      const message = {
        role: 'assistant',
        content: 'answer',
        refusal: null,
        provider_specific_fields: {
          reasoning_content: 'LiteLLM-wrapped reasoning',
        },
      } as unknown as OpenAIClient.ChatCompletionMessage;

      const result = instance._convertCompletionsMessageToBaseMessage(
        message,
        baseResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBe(
        'LiteLLM-wrapped reasoning',
      );
      expect(
        (result.response_metadata as ResponseMetadataWithProvider)
          ?.model_provider,
      ).toBe('deepseek');
    });

    it('should prefer top-level reasoning_content over provider_specific_fields', () => {
      const message = {
        role: 'assistant',
        content: 'answer',
        refusal: null,
        reasoning_content: 'Top-level reasoning',
        provider_specific_fields: {
          reasoning_content: 'Wrapped reasoning',
        },
      } as unknown as OpenAIClient.ChatCompletionMessage;

      const result = instance._convertCompletionsMessageToBaseMessage(
        message,
        baseResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBe(
        'Top-level reasoning',
      );
    });

    it('should ignore empty reasoning_content', () => {
      const message = {
        role: 'assistant',
        content: 'answer',
        refusal: null,
        reasoning_content: '',
      } as unknown as OpenAIClient.ChatCompletionMessage;

      const result = instance._convertCompletionsMessageToBaseMessage(
        message,
        baseResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBeUndefined();
    });
  });

  describe('_convertCompletionsDeltaToBaseMessageChunk', () => {
    const baseChunkResponse: OpenAIClient.ChatCompletionChunk = {
      id: 'chatcmpl-chunk-1',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    };

    it('should pass through when no reasoning_content in delta', () => {
      const delta = { role: 'assistant', content: 'hello' };

      const result = instance._convertCompletionsDeltaToBaseMessageChunk(
        delta,
        baseChunkResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBeUndefined();
    });

    it('should inject reasoning_content from delta', () => {
      const delta = {
        role: 'assistant',
        content: '',
        reasoning_content: 'Thinking chunk...',
      };

      const result = instance._convertCompletionsDeltaToBaseMessageChunk(
        delta,
        baseChunkResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBe(
        'Thinking chunk...',
      );
      expect(
        (result.response_metadata as ResponseMetadataWithProvider)
          ?.model_provider,
      ).toBe('deepseek');
    });

    it('should inject reasoning_content from provider_specific_fields in delta', () => {
      const delta = {
        role: 'assistant',
        content: '',
        provider_specific_fields: {
          reasoning_content: 'LiteLLM delta reasoning',
        },
      };

      const result = instance._convertCompletionsDeltaToBaseMessageChunk(
        delta,
        baseChunkResponse,
      );

      expect(result.additional_kwargs.reasoning_content).toBe(
        'LiteLLM delta reasoning',
      );
    });
  });
});
