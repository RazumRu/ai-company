import { Injectable } from '@nestjs/common';
import { compact, isObject } from 'lodash';
import OpenAI from 'openai';
import { ResponseCreateParams } from 'openai/resources/responses/responses';

import { environment } from '../../environments';
import type { RequestTokenUsage } from '../litellm/litellm.types';
import { LitellmService } from '../litellm/services/litellm.service';
import ResponseCreateParamsNonStreaming = ResponseCreateParams.ResponseCreateParamsNonStreaming;

type GenerateResult<T> = {
  content?: T;
  conversationId: string;
  usage?: RequestTokenUsage;
};

type EmbeddingsInput = {
  model: string;
  input: string | string[];
};

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({
    apiKey: environment.litellmMasterKey,
    baseURL: environment.llmBaseUrl,
  });

  constructor(
    private readonly litellmService: LitellmService,
  ) {}

  async response(
    data: {
      message: string;
      systemMessage?: string;
    },
    params: ResponseCreateParamsNonStreaming,
  ): Promise<GenerateResult<string>>;
  async response<T>(
    data: {
      message: string;
      systemMessage?: string;
    },
    params: ResponseCreateParamsNonStreaming,
    options: {
      json: true;
    },
  ): Promise<GenerateResult<T>>;
  async response<T>(
    data: {
      message: string;
      systemMessage?: string;
    },
    params: ResponseCreateParamsNonStreaming,
    options?: {
      json?: boolean;
    },
  ): Promise<GenerateResult<T | string>> {
    const response = await this.client.responses.create({
      ...params,
      input: compact([
        data.systemMessage
          ? { role: 'system', content: data.systemMessage }
          : undefined,
        { role: 'user', content: data.message },
      ]),
    });

    const extractedContent =
      response.output_text ?? this.extractFromOutput(response);

    // Use fallback to estimate price from model rates if not provided in response
    const modelName = typeof params.model === 'string' ? params.model : '';

    const usage =
      (await this.litellmService.extractTokenUsageFromResponse(
        modelName,
        response.usage,
      )) || undefined;

    if (options?.json) {
      const parsed = (() => {
        if (!extractedContent) return undefined;
        const trimmed = extractedContent.trim();
        if (!trimmed) return undefined;
        const jsonString = trimmed.startsWith('```')
          ? trimmed
              .replace(/^```[a-zA-Z]*\n?/, '')
              .replace(/```$/, '')
              .trim()
          : trimmed;
        try {
          return JSON.parse(jsonString) as unknown;
        } catch {
          return undefined;
        }
      })();
      return {
        content: parsed as T,
        conversationId: response.id,
        usage,
      };
    }

    return {
      content: extractedContent,
      conversationId: response.id,
      usage,
    };
  }

  async embeddings(args: EmbeddingsInput): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: args.model,
      input: args.input,
    });
    return response.data.map((item) => item.embedding);
  }

  private extractFromOutput(response: unknown): string | undefined {
    const output = (response as { output?: unknown[] }).output;
    if (!Array.isArray(output)) {
      return undefined;
    }

    const parts = output
      .map((block) => {
        const content = (block as { content?: unknown[] }).content;
        if (!Array.isArray(content)) return undefined;

        return content
          .map((item) => {
            const textValue = (item as { text?: unknown }).text;
            if (typeof textValue === 'string') {
              return textValue;
            }

            if (isObject(textValue)) {
              const valueHolder = textValue as { value?: unknown };
              if (typeof valueHolder.value === 'string') {
                return valueHolder.value;
              }
            }
            return undefined;
          })
          .filter(Boolean)
          .join('\n');
      })
      .filter(Boolean)
      .join('\n\n');

    return parts.length ? parts : undefined;
  }
}
