import { Injectable } from '@nestjs/common';
import { OpenAI } from 'openai';
import {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses';

import { environment } from '../../../environments';

@Injectable()
export class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: environment.litellmMasterKey,
      baseURL: environment.llmBaseUrl,
    });
  }

  public async createCompletion(
    params: OpenAI.ChatCompletionCreateParamsNonStreaming,
  ): Promise<{
    output: string;
    body: OpenAI.ChatCompletion;
  }> {
    const completion = await this.client.chat.completions.create(params);

    const output = completion.choices[0]?.message.content || '';

    return {
      output,
      body: completion,
    };
  }

  public async createResponse(
    params: ResponseCreateParamsNonStreaming,
  ): Promise<{
    output: string;
    body: Response;
  }> {
    const response = await this.client.responses.create(params);

    const output = response.output_text || '';

    return {
      output,
      body: response,
    };
  }
}
