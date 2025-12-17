import { encodingForModel, getEncoding } from '@langchain/core/utils/tiktoken';
import { Injectable } from '@nestjs/common';

import { LiteLlmModelDto } from '../dto/models.dto';
import type { MessageTokenUsage, TokenUsage } from '../litellm.types';
import { LiteLlmClient } from './litellm.client';

type LiteLLMModelPriceEntry = Record<string, unknown>;
type TokenCostRates = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  inputCostPerCachedToken?: number;
  outputCostPerReasoningToken?: number;
};

export type MessageCostDirection = 'input' | 'output' | 'reasoning';

@Injectable()
export class LitellmService {
  private static readonly MODEL_PRICES_URL =
    'https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json';
  private static readonly MODEL_PRICES_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  private modelPricesCache: {
    expiresAt: number;
    data: Record<string, LiteLLMModelPriceEntry>;
  } | null = null;
  private modelPricesInFlight: Promise<
    Record<string, LiteLLMModelPriceEntry>
  > | null = null;

  constructor(private readonly liteLlmClient: LiteLlmClient) {}

  async listModels(): Promise<LiteLlmModelDto[]> {
    const response = await this.liteLlmClient.listModels();

    return response.map((m) => ({
      id: m.id,
      ownedBy: m.owned_by,
    }));
  }

  async countTokens(model: string, content: unknown): Promise<number> {
    const text = this.coerceText(content);
    try {
      const enc =
        (typeof model === 'string' && model.length > 0
          ? await encodingForModel(model as never)
          : null) ?? (await getEncoding('cl100k_base'));
      return enc.encode(text).length;
    } catch {
      return Math.max(0, Math.ceil(text.length / 4));
    }
  }

  extractTokenUsageFromAdditionalKwargs(
    additionalKwargs?:
      | { tokenUsage?: unknown }
      | ({ tokenUsage?: unknown } | null | undefined)[]
      | null,
  ): TokenUsage | null {
    const parseSingle = (
      single?: { tokenUsage?: unknown } | null,
    ): TokenUsage | null => {
      const maybe = single?.tokenUsage;
      if (!maybe || typeof maybe !== 'object') {
        return null;
      }

      const obj = maybe as Record<string, unknown>;

      const inputTokens = this.readNumber(obj.inputTokens);
      const outputTokens = this.readNumber(obj.outputTokens);
      const totalTokens = this.readNumber(obj.totalTokens);

      if (
        inputTokens === undefined ||
        outputTokens === undefined ||
        totalTokens === undefined
      ) {
        return null;
      }

      const cachedInputTokens = this.readNumber(obj.cachedInputTokens);
      const reasoningTokens = this.readNumber(obj.reasoningTokens);
      const totalPrice = this.readNumber(obj.totalPrice);

      return {
        inputTokens,
        ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
        outputTokens,
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        totalTokens,
        ...(totalPrice !== undefined ? { totalPrice } : {}),
      };
    };

    if (Array.isArray(additionalKwargs)) {
      return this.sumTokenUsages(additionalKwargs.map((kw) => parseSingle(kw)));
    }

    return parseSingle(additionalKwargs);
  }

  extractMessageTokenUsageFromAdditionalKwargs(
    additionalKwargs?: { tokenUsage?: unknown } | null,
  ): MessageTokenUsage | null {
    const maybe = additionalKwargs?.tokenUsage;
    if (!maybe || typeof maybe !== 'object') {
      return null;
    }
    const obj = maybe as Record<string, unknown>;
    const totalTokens = this.readNumber(obj.totalTokens);
    if (totalTokens === undefined) {
      return null;
    }
    const totalPrice = this.readNumberish(obj.totalPrice);
    return {
      totalTokens,
      ...(totalPrice !== undefined ? { totalPrice } : {}),
    };
  }

  sumTokenUsages(usages: (TokenUsage | null | undefined)[]): TokenUsage | null {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;
    let totalPrice = 0;
    let sawAny = false;
    let sawPrice = false;

    for (const usage of usages) {
      if (!usage) continue;
      sawAny = true;
      inputTokens += usage.inputTokens;
      cachedInputTokens += usage.cachedInputTokens ?? 0;
      outputTokens += usage.outputTokens;
      reasoningTokens += usage.reasoningTokens ?? 0;
      totalTokens += usage.totalTokens;
      if (typeof usage.totalPrice === 'number') {
        totalPrice += usage.totalPrice;
        sawPrice = true;
      }
    }

    if (!sawAny) {
      return null;
    }

    return {
      inputTokens,
      ...(cachedInputTokens ? { cachedInputTokens } : {}),
      outputTokens,
      ...(reasoningTokens ? { reasoningTokens } : {}),
      totalTokens,
      ...(sawPrice ? { totalPrice } : {}),
    };
  }

  /**
   * Extract token usage + (best-effort) cost from LangChain's ChatOpenAI response
   * when using a LiteLLM proxy.
   *
   * LiteLLM can attach cost under `response_metadata.response_cost` or
   * `response_metadata._hidden_params.response_cost` (depending on proxy/config).
   */
  extractTokenUsageFromResponse(res: {
    usage_metadata?: unknown;
    response_metadata?: unknown;
  }): TokenUsage | null {
    const usageMetadata = res.usage_metadata;
    if (!usageMetadata || typeof usageMetadata !== 'object') {
      return null;
    }

    const usage = usageMetadata as Record<string, unknown>;

    const inputTokens = this.readNumber(usage.input_tokens) ?? 0;
    const outputTokens = this.readNumber(usage.output_tokens) ?? 0;

    const inputTokensDetails = usage.input_tokens_details;
    const cachedInputTokens =
      inputTokensDetails && typeof inputTokensDetails === 'object'
        ? this.readNumber(
            (inputTokensDetails as Record<string, unknown>).cached_tokens,
          )
        : undefined;

    const reasoningTokens =
      usage.output_tokens_details &&
      typeof usage.output_tokens_details === 'object'
        ? this.readNumber(
            (usage.output_tokens_details as Record<string, unknown>)
              .reasoning_tokens,
          )
        : undefined;

    const totalTokens =
      this.readNumber(usage.total_tokens) ??
      inputTokens + outputTokens + (reasoningTokens ?? 0);

    // Cost comes only from LiteLLM proxy metadata if present.
    const responseMetadata = res.response_metadata;
    let totalPrice: number | undefined;

    if (responseMetadata && typeof responseMetadata === 'object') {
      const meta = responseMetadata as Record<string, unknown>;
      totalPrice ??=
        this.readNumber(meta.response_cost) ??
        this.readNumber(
          (meta._hidden_params as Record<string, unknown> | undefined)
            ?.response_cost,
        );
    }

    return {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      ...(totalPrice !== undefined ? { totalPrice } : {}),
    };
  }

  async extractTokenUsageFromResponseWithPriceFallback(args: {
    model: string;
    usage_metadata?: unknown;
    response_metadata?: unknown;
  }): Promise<TokenUsage | null> {
    const usage = this.extractTokenUsageFromResponse({
      usage_metadata: args.usage_metadata,
      response_metadata: args.response_metadata,
    });
    if (!usage) {
      return null;
    }
    if (usage.totalPrice !== undefined) {
      return usage;
    }

    const estimated = await this.estimateThreadTotalPriceFromModelRates({
      model: args.model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens ?? 0,
    });
    if (estimated === null) {
      return usage;
    }
    return { ...usage, totalPrice: estimated };
  }

  /** @internal */
  resetLiteLLMModelPricesCacheForTests() {
    this.modelPricesCache = null;
    this.modelPricesInFlight = null;
  }

  async getTokenCostRatesForModel(
    model: string,
  ): Promise<TokenCostRates | null> {
    if (!model || typeof model !== 'string') return null;
    const prices = await this.getLiteLLMModelPrices();

    const candidates = [
      model,
      model.toLowerCase(),
      model.includes('/') ? (model.split('/').pop() ?? model) : undefined,
      model.toLowerCase().includes('/')
        ? model.toLowerCase().split('/').pop()
        : undefined,
    ].filter((x): x is string => typeof x === 'string' && x.length > 0);

    const entry =
      candidates.map((c) => prices[c]).find((e) => e !== undefined) ?? null;
    if (!entry) return null;

    const inputCostPerToken = this.readNumberish(entry.input_cost_per_token);
    const outputCostPerToken = this.readNumberish(entry.output_cost_per_token);
    if (inputCostPerToken === undefined || outputCostPerToken === undefined) {
      return null;
    }

    const inputCostPerCachedToken =
      this.readNumberish(entry.input_cost_per_token_cache_hit) ??
      this.readNumberish(entry.cache_read_input_token_cost);
    const outputCostPerReasoningToken = this.readNumberish(
      entry.output_cost_per_reasoning_token,
    );

    return {
      inputCostPerToken,
      outputCostPerToken,
      ...(inputCostPerCachedToken !== undefined
        ? { inputCostPerCachedToken }
        : {}),
      ...(outputCostPerReasoningToken !== undefined
        ? { outputCostPerReasoningToken }
        : {}),
    };
  }

  async estimateThreadTotalPriceFromModelRates(args: {
    model: string;
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    reasoningTokens?: number;
  }): Promise<number | null> {
    const rates = await this.getTokenCostRatesForModel(args.model);
    if (!rates) return null;

    const cached = Math.max(0, args.cachedInputTokens ?? 0);
    const input = Math.max(0, args.inputTokens);
    const nonCached = Math.max(0, input - cached);
    const output = Math.max(0, args.outputTokens);
    const reasoning = Math.max(0, args.reasoningTokens ?? 0);

    const cachedRate = rates.inputCostPerCachedToken ?? rates.inputCostPerToken;
    const reasoningRate = rates.outputCostPerReasoningToken ?? 0;

    return (
      nonCached * rates.inputCostPerToken +
      cached * cachedRate +
      output * rates.outputCostPerToken +
      reasoning * reasoningRate
    );
  }

  async estimateMessageTotalPriceFromModelRates(args: {
    model: string;
    direction: MessageCostDirection;
    totalTokens: number;
  }): Promise<number | null> {
    const rates = await this.getTokenCostRatesForModel(args.model);
    if (!rates) return null;

    const tokens = Math.max(0, args.totalTokens);
    if (tokens === 0) return 0;

    if (args.direction === 'input') {
      return tokens * rates.inputCostPerToken;
    }
    if (args.direction === 'reasoning') {
      const r = rates.outputCostPerReasoningToken ?? rates.outputCostPerToken;
      return tokens * r;
    }
    return tokens * rates.outputCostPerToken;
  }

  /**
   * Attach token usage to a message's additional_kwargs.
   *
   * @param message - The message to attach token usage to
   * @param model - The model name used for token counting
   * @param options - Optional configuration
   * @param options.direction - Cost direction (input/output/reasoning) for price estimation. Defaults to 'input'.
   * @param options.threadUsage - Full thread token usage from LLM response. If provided, price is calculated proportionally.
   * @param options.skipIfExists - If true, skip messages that already have tokenUsage. Defaults to true.
   * @returns The message token usage that was attached
   */
  async attachTokenUsageToMessage(
    message: {
      content: unknown;
      tool_calls?: unknown[];
      additional_kwargs?: Record<string, unknown>;
    },
    model: string,
    options?: {
      direction?: MessageCostDirection;
      threadUsage?: TokenUsage | null;
      skipIfExists?: boolean;
    },
  ): Promise<MessageTokenUsage | null> {
    const skipIfExists = options?.skipIfExists ?? true;

    // Skip if message already has tokenUsage
    if (skipIfExists && message.additional_kwargs?.tokenUsage) {
      return message.additional_kwargs.tokenUsage as MessageTokenUsage;
    }

    // Calculate token count for this message
    const messageForCounting = {
      content: message.content,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
    const totalTokens = await this.countTokens(
      model,
      JSON.stringify(messageForCounting),
    );

    // Calculate price
    let totalPrice: number | undefined;

    if (options?.threadUsage) {
      // Proportional allocation from thread usage
      totalPrice =
        options.threadUsage.totalPrice !== undefined &&
        options.threadUsage.totalTokens > 0
          ? (totalTokens / options.threadUsage.totalTokens) *
            options.threadUsage.totalPrice
          : undefined;
    } else {
      // Estimate from model rates
      const estimated = await this.estimateMessageTotalPriceFromModelRates({
        model,
        direction: options?.direction ?? 'input',
        totalTokens,
      });
      totalPrice = estimated ?? undefined;
    }

    const tokenUsage: MessageTokenUsage = {
      totalTokens,
      ...(totalPrice !== undefined ? { totalPrice } : {}),
    };

    // Attach to additional_kwargs
    message.additional_kwargs = {
      ...(message.additional_kwargs ?? {}),
      tokenUsage,
    };

    return tokenUsage;
  }

  /**
   * Attach token usage to multiple messages.
   *
   * @param messages - Array of messages to process
   * @param model - The model name used for token counting
   * @param options - Optional configuration (same as attachTokenUsageToMessage)
   */
  async attachTokenUsageToMessages(
    messages: {
      content: unknown;
      tool_calls?: unknown[];
      additional_kwargs?: Record<string, unknown>;
    }[],
    model: string,
    options?: {
      direction?: MessageCostDirection;
      threadUsage?: TokenUsage | null;
      skipIfExists?: boolean;
    },
  ): Promise<void> {
    await Promise.all(
      messages.map((msg) =>
        this.attachTokenUsageToMessage(msg, model, options),
      ),
    );
  }

  private readNumber(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0
      ? v
      : undefined;
  }

  private readNumberish(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    return undefined;
  }

  private coerceText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (content === null || content === undefined) return '';
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  private async getLiteLLMModelPrices(): Promise<
    Record<string, LiteLLMModelPriceEntry>
  > {
    const now = Date.now();
    if (this.modelPricesCache && this.modelPricesCache.expiresAt > now) {
      return this.modelPricesCache.data;
    }
    if (this.modelPricesInFlight) {
      return this.modelPricesInFlight;
    }

    this.modelPricesInFlight = (async () => {
      const fetchFn = globalThis.fetch;
      if (typeof fetchFn !== 'function') {
        throw new Error('fetch is not available in this runtime');
      }

      const res = await fetchFn(LitellmService.MODEL_PRICES_URL);
      if (!res.ok) {
        throw new Error(`Failed to fetch model prices: ${res.status}`);
      }
      const json = (await res.json()) as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('Invalid model prices JSON');
      }

      const out: Record<string, LiteLLMModelPriceEntry> = {};
      for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          out[k] = v as LiteLLMModelPriceEntry;
        }
      }

      this.modelPricesCache = {
        expiresAt: Date.now() + LitellmService.MODEL_PRICES_TTL_MS,
        data: out,
      };
      return out;
    })().finally(() => {
      this.modelPricesInFlight = null;
    });

    return this.modelPricesInFlight;
  }
}
