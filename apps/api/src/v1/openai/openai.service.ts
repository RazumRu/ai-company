import { Injectable } from '@nestjs/common';
import { compact, isObject } from 'lodash';
import OpenAI from 'openai';
import { zodResponseFormat, zodTextFormat } from 'openai/helpers/zod';
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import { ZodObject } from 'zod';

import { environment } from '../../environments';
import type { RequestTokenUsage } from '../litellm/litellm.types';
import { LitellmService } from '../litellm/services/litellm.service';

type GenerateResult<T> = {
  content?: T;
  conversationId: string;
  usage?: RequestTokenUsage;
};

type EmbeddingsInput = {
  model: string;
  input: string | string[];
};

export type EmbeddingsResult = {
  embeddings: number[][];
  usage?: RequestTokenUsage;
};

type SortReasoning = { effort: 'minimal' | 'low' | 'medium' | 'high' };

type BaseData = {
  model: string;
  message: string;
  systemMessage?: string;
  reasoning?: SortReasoning;
};

type JsonEnabled = {
  json: true;
  jsonSchema: ZodObject;
};

type JsonDisabled = {
  json?: false;
};

export type ResponseData = BaseData & JsonDisabled;
export type ResponseJsonData = BaseData & JsonEnabled;

export type CompleteData = BaseData & JsonDisabled;
export type CompleteJsonData = BaseData & JsonEnabled;

type CompletionParams = Omit<
  ChatCompletionCreateParamsNonStreaming,
  'model' | 'messages' | 'response_format'
>;

type ResponsesParams = Omit<
  ResponseCreateParamsNonStreaming,
  'model' | 'input' | 'text'
>;

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({
    apiKey: environment.litellmMasterKey,
    baseURL: environment.llmBaseUrl,
    timeout: environment.llmRequestTimeoutMs,
  });

  constructor(private readonly litellmService: LitellmService) {}

  async complete(
    data: CompleteData,
    params?: CompletionParams,
  ): Promise<GenerateResult<string>>;
  async complete<T>(
    data: CompleteJsonData,
    params?: CompletionParams,
  ): Promise<GenerateResult<T>>;
  async complete<T>(
    data: CompleteData | CompleteJsonData,
    params?: CompletionParams,
  ): Promise<GenerateResult<T | string>> {
    const messages = compact([
      data.systemMessage
        ? { role: 'system' as const, content: data.systemMessage }
        : undefined,
      { role: 'user' as const, content: data.message },
    ]);

    const generatedSchema =
      'jsonSchema' in data && zodResponseFormat(data.jsonSchema, 'schema');
    const response = await this.client.chat.completions.create({
      ...(params ?? {}),
      model: data.model,
      messages,
      ...(generatedSchema
        ? {
            response_format: generatedSchema,
          }
        : {}),
    });

    const content = response.choices?.[0]?.message?.content ?? undefined;

    const usage = response.usage
      ? (await this.litellmService.extractTokenUsageFromResponse(data.model, {
          input_tokens: response.usage.prompt_tokens ?? 0,
          output_tokens: response.usage.completion_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? 0,
        })) || undefined
      : undefined;

    if ('jsonSchema' in data) {
      return {
        content: this.parseJson<T>(content) ?? undefined,
        conversationId: String(response.id),
        usage,
      };
    }

    return {
      content,
      conversationId: String(response.id),
      usage,
    };
  }

  async response(
    data: ResponseData,
    params?: ResponsesParams,
  ): Promise<GenerateResult<string>>;
  async response<T>(
    data: ResponseJsonData,
    params?: ResponsesParams,
  ): Promise<GenerateResult<T>>;
  async response<T>(
    data: ResponseData | ResponseJsonData,
    params?: ResponsesParams,
  ): Promise<GenerateResult<T | string>> {
    const generatedSchema =
      'jsonSchema' in data && zodTextFormat(data.jsonSchema, 'schema');

    const response = await this.client.responses.create({
      ...(params ?? {}),
      ...(data.reasoning ? { reasoning: data.reasoning } : {}),
      ...(generatedSchema
        ? {
            text: {
              format: generatedSchema,
            },
          }
        : {}),
      model: data.model,
      input: compact([
        data.systemMessage
          ? { role: 'system', content: data.systemMessage }
          : undefined,
        { role: 'user', content: data.message },
      ]),
    });

    const outputText =
      typeof (response as { output_text?: unknown }).output_text === 'string'
        ? (response as { output_text: string }).output_text
        : undefined;

    const extractedContent = outputText ?? this.extractFromOutput(response);

    const usage =
      (await this.litellmService.extractTokenUsageFromResponse(
        data.model,
        response.usage,
      )) || undefined;

    if ('jsonSchema' in data) {
      return {
        content: this.parseJson<T>(extractedContent) ?? undefined,
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

  async embeddings(args: EmbeddingsInput): Promise<EmbeddingsResult> {
    const response = await this.client.embeddings.create({
      model: args.model,
      input: args.input,
    });
    const usage = response.usage
      ? (await this.litellmService.extractTokenUsageFromResponse(args.model, {
          input_tokens: response.usage.prompt_tokens ?? 0,
          output_tokens: 0,
          total_tokens: response.usage.total_tokens ?? 0,
        })) || undefined
      : undefined;

    return {
      embeddings: response.data.map((item) => item.embedding),
      usage,
    };
  }

  private extractFromOutput(response: unknown): string | undefined {
    const output = isObject(response)
      ? (response as { output?: unknown }).output
      : undefined;
    if (!Array.isArray(output)) return undefined;

    const parts = output
      .map((block) => {
        const content = isObject(block)
          ? (block as { content?: unknown }).content
          : undefined;
        if (!Array.isArray(content)) return undefined;

        return content
          .map((item) => {
            const textValue = isObject(item)
              ? (item as { text?: unknown }).text
              : undefined;
            if (typeof textValue === 'string') return textValue;

            if (isObject(textValue)) {
              const v = (textValue as { value?: unknown }).value;
              if (typeof v === 'string') return v;
            }

            return undefined;
          })
          .filter((x): x is string => typeof x === 'string')
          .join('\n');
      })
      .filter((x): x is string => typeof x === 'string')
      .join('\n\n');

    return parts.length ? parts : undefined;
  }

  private parseJson<T>(content?: string): T | null {
    if (!content) return null;

    const trimmed = content.trim();
    if (!trimmed) return null;

    const jsonString = trimmed.startsWith('```')
      ? trimmed
          .replace(/^```[a-zA-Z]*\n?/, '')
          .replace(/```$/, '')
          .trim()
      : trimmed;

    try {
      return JSON.parse(jsonString) as T;
    } catch {
      return null;
    }
  }
}
