import { Injectable } from '@nestjs/common';
import { compact } from 'lodash';
import OpenAI from 'openai';
import { ResponseCreateParams } from 'openai/resources/responses/responses';

import { environment } from '../../environments';
import ResponseCreateParamsNonStreaming = ResponseCreateParams.ResponseCreateParamsNonStreaming;

type GenerateResult = {
  content?: string;
  conversationId: string;
};

@Injectable()
export class OpenaiService {
  private readonly client = new OpenAI({
    apiKey: environment.litellmMasterKey,
    baseURL: environment.llmBaseUrl,
  });

  async response(
    data: {
      message: string;
      systemMessage?: string;
    },
    params: ResponseCreateParamsNonStreaming,
  ): Promise<GenerateResult> {
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
      // Prefer the SDK convenience field if present
      (response as { output_text?: string }).output_text ??
      this.extractFromOutput(response);

    return {
      content: extractedContent,
      conversationId: response.id,
    };
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
            if (typeof textValue === 'string') return textValue;
            if (
              textValue &&
              typeof textValue === 'object' &&
              typeof (textValue as { value?: unknown }).value === 'string'
            ) {
              return (textValue as { value?: string }).value;
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
