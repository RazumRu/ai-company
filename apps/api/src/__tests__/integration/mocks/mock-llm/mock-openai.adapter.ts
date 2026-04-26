import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { environment } from '../../../../environments';
import type { RequestTokenUsage } from '../../../../v1/litellm/litellm.types';
import { LitellmService } from '../../../../v1/litellm/services/litellm.service';
import {
  CompleteData,
  CompleteJsonData,
  EmbeddingsResult,
  OpenaiService,
  ResponseData,
  ResponseJsonData,
} from '../../../../v1/openai/openai.service';
import { MockLlmService } from './mock-llm.service';
import type { MockLlmReply, MockLlmRequest } from './mock-llm.types';

type CompletionParams = Parameters<OpenaiService['complete']>[1];
type ResponsesParams = Parameters<OpenaiService['response']>[1];
type JsonRequestData = Parameters<OpenaiService['jsonRequest']>[0];

/**
 * Offline drop-in replacement for `OpenaiService` used in integration tests.
 *
 * Every public method intercepts the LLM call, delegates to `MockLlmService`
 * for fixture/queue resolution, and returns a shaped result identical to the
 * real service — without making any network requests.
 *
 * The OpenAI client constructed by the parent class is never invoked: all
 * overrides return before reaching `this.client.*` calls inherited from
 * `OpenaiService`.
 *
 * ### Offline-cost rule
 * Usage pricing is computed entirely from the fixture's `usage.totalPrice`
 * field. `LitellmService.extractTokenUsageFromResponse` is never called to
 * avoid the `liteLlmClient.getModelInfo` HTTP round-trip it triggers.
 * - When `reply.usage.totalPrice` is set → returned as `usage.totalPrice`.
 * - When absent → `usage.totalPrice` is `0`.
 */
@Injectable()
export class MockOpenaiAdapter extends OpenaiService {
  constructor(
    private readonly mockLlm: MockLlmService,
    litellmService: LitellmService,
  ) {
    super(litellmService);
  }

  // ---------------------------------------------------------------------------
  // complete — text overload
  // ---------------------------------------------------------------------------

  override async complete(
    data: CompleteData,
    params?: CompletionParams,
  ): Promise<{
    content?: string;
    conversationId: string;
    usage?: RequestTokenUsage;
  }>;

  // ---------------------------------------------------------------------------
  // complete — JSON overload
  // ---------------------------------------------------------------------------

  override async complete<T>(
    data: CompleteJsonData,
    params?: CompletionParams,
  ): Promise<{
    content?: T;
    conversationId: string;
    usage?: RequestTokenUsage;
  }>;

  // ---------------------------------------------------------------------------
  // complete — implementation
  // ---------------------------------------------------------------------------

  override async complete<T>(
    data: CompleteData | CompleteJsonData,
    _params?: CompletionParams,
  ): Promise<{
    content?: T | string;
    conversationId: string;
    usage?: RequestTokenUsage;
  }> {
    const callIndex = this.mockLlm.nextCallIndex();
    const isJson = 'jsonSchema' in data;

    const request: MockLlmRequest = {
      kind: isJson ? 'json' : 'chat',
      model: data.model,
      messages: [
        ...(data.systemMessage
          ? [{ role: 'system', content: data.systemMessage }]
          : []),
        { role: 'user', content: data.message },
      ],
      systemMessage: data.systemMessage,
      lastUserMessage: data.message,
      callIndex,
    };

    const reply = this.mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    const expectedKind = isJson ? 'json' : 'text';
    if (reply.kind !== expectedKind) {
      throw new Error(
        `MockOpenaiAdapter.complete expected '${expectedKind}' reply, got '${reply.kind}'`,
      );
    }

    const usage = buildUsage(reply);

    return {
      content: reply.content as T | string,
      conversationId: randomUUID(),
      usage,
    };
  }

  // ---------------------------------------------------------------------------
  // response — text overload
  // ---------------------------------------------------------------------------

  override async response(
    data: ResponseData,
    params?: ResponsesParams,
  ): Promise<{
    content?: string;
    conversationId: string;
    usage?: RequestTokenUsage;
  }>;

  // ---------------------------------------------------------------------------
  // response — JSON overload
  // ---------------------------------------------------------------------------

  override async response<T>(
    data: ResponseJsonData,
    params?: ResponsesParams,
  ): Promise<{
    content?: T;
    conversationId: string;
    usage?: RequestTokenUsage;
  }>;

  // ---------------------------------------------------------------------------
  // response — implementation
  // ---------------------------------------------------------------------------

  override async response<T>(
    data: ResponseData | ResponseJsonData,
    _params?: ResponsesParams,
  ): Promise<{
    content?: T | string;
    conversationId: string;
    usage?: RequestTokenUsage;
  }> {
    const callIndex = this.mockLlm.nextCallIndex();
    const isJson = 'jsonSchema' in data;

    const request: MockLlmRequest = {
      kind: isJson ? 'json' : 'chat',
      model: data.model,
      messages: [
        ...(data.systemMessage
          ? [{ role: 'system', content: data.systemMessage }]
          : []),
        { role: 'user', content: data.message },
      ],
      systemMessage: data.systemMessage,
      lastUserMessage: data.message,
      callIndex,
    };

    const reply = this.mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    const expectedKind = isJson ? 'json' : 'text';
    if (reply.kind !== expectedKind) {
      throw new Error(
        `MockOpenaiAdapter.response expected '${expectedKind}' reply, got '${reply.kind}'`,
      );
    }

    const usage = buildUsage(reply);

    return {
      content: reply.content as T | string,
      conversationId: randomUUID(),
      usage,
    };
  }

  // ---------------------------------------------------------------------------
  // jsonRequest — delegates to complete/response based on fixture kind
  // ---------------------------------------------------------------------------

  override async jsonRequest<T>(data: JsonRequestData): Promise<{
    content?: T;
    conversationId: string;
    usage?: RequestTokenUsage;
  }> {
    const callIndex = this.mockLlm.nextCallIndex();

    const request: MockLlmRequest = {
      kind: 'json',
      model: data.model,
      messages: [
        ...(data.systemMessage
          ? [{ role: 'system', content: data.systemMessage }]
          : []),
        { role: 'user', content: data.message },
      ],
      systemMessage: data.systemMessage,
      lastUserMessage: data.message,
      callIndex,
    };

    const reply = this.mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    if (reply.kind !== 'json') {
      throw new Error(
        `MockOpenaiAdapter.jsonRequest expected 'json' reply, got '${reply.kind}'`,
      );
    }

    const usage = buildUsage(reply);

    return {
      content: reply.content as T,
      conversationId: randomUUID(),
      usage,
    };
  }

  // ---------------------------------------------------------------------------
  // embeddings
  // ---------------------------------------------------------------------------

  override async embeddings(args: {
    model: string;
    input: string | string[];
    dimensions?: number;
  }): Promise<EmbeddingsResult> {
    const callIndex = this.mockLlm.nextCallIndex();
    const embeddingInput = args.input;

    const request: MockLlmRequest = {
      kind: 'embeddings',
      model: args.model,
      embeddingInput,
      callIndex,
    };

    const reply = this.mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    if (reply.kind !== 'embeddings') {
      throw new Error(
        `MockOpenaiAdapter.embeddings expected 'embeddings' reply, got '${reply.kind}'`,
      );
    }

    const inputs = Array.isArray(embeddingInput)
      ? embeddingInput
      : [embeddingInput];

    const targetDimensions =
      args.dimensions ?? environment.llmEmbeddingDimensions;

    const vectors = inputs.map((input) => {
      const rawVec =
        typeof reply.vector === 'function' ? reply.vector(input) : reply.vector;
      return padOrTruncate(rawVec, targetDimensions);
    });

    const usage = buildUsage(reply);

    return { embeddings: vectors, usage };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a `RequestTokenUsage` from a reply's optional `usage` field.
 *
 * The offline-cost rule: we never call `LitellmService.extractTokenUsageFromResponse`
 * because it always triggers a `liteLlmClient.getModelInfo` HTTP call under the
 * hood (even when a provider `cost` field is present). Instead, we read
 * `reply.usage.totalPrice` directly and return `0` when absent.
 *
 * Returns `undefined` when the reply carries no `usage` at all (matches the
 * real service behaviour when `response.usage` is absent).
 */
function buildUsage(
  reply: Exclude<MockLlmReply, { kind: 'error' }>,
): RequestTokenUsage | undefined {
  if (!reply.usage) {
    return undefined;
  }

  const inputTokens = reply.usage.inputTokens ?? 0;
  const outputTokens = reply.usage.outputTokens ?? 0;
  const totalTokens = reply.usage.totalTokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    totalPrice: reply.usage.totalPrice ?? 0,
    ...(reply.usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: reply.usage.cachedInputTokens }
      : {}),
    ...(reply.usage.reasoningTokens !== undefined
      ? { reasoningTokens: reply.usage.reasoningTokens }
      : {}),
    ...(reply.usage.currentContext !== undefined
      ? { currentContext: reply.usage.currentContext }
      : {}),
    ...(reply.usage.durationMs !== undefined
      ? { durationMs: reply.usage.durationMs }
      : {}),
  };
}

/**
 * Pad a vector with zeros or truncate it to exactly `dimensions` elements.
 * Ensures mock vectors conform to the expected embedding size regardless of
 * what the fixture returns.
 */
function padOrTruncate(vec: number[], dimensions: number): number[] {
  if (vec.length === dimensions) {
    return vec;
  }
  if (vec.length > dimensions) {
    return vec.slice(0, dimensions);
  }
  return [...vec, ...new Array<number>(dimensions - vec.length).fill(0)];
}
