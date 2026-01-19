import { encodingForModel, getEncoding } from '@langchain/core/utils/tiktoken';
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import { LiteLlmModelDto } from '../dto/models.dto';
import { RequestTokenUsage, UsageMetadata } from '../litellm.types';
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
    const text =
      typeof content === 'string' ? content : JSON.stringify(content ?? '');
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

  sumTokenUsages(
    usages: (RequestTokenUsage | null | undefined)[],
  ): RequestTokenUsage | null {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    let totalTokens = 0;
    let totalPriceDecimal = new Decimal(0);
    let currentContext = 0;
    let sawAny = false;
    let sawPrice = false;
    let sawContext = false;

    for (const usage of usages) {
      if (!usage) continue;
      sawAny = true;
      inputTokens += usage.inputTokens;
      cachedInputTokens += usage.cachedInputTokens ?? 0;
      outputTokens += usage.outputTokens;
      reasoningTokens += usage.reasoningTokens ?? 0;
      totalTokens += usage.totalTokens;
      if (typeof usage.totalPrice === 'number') {
        totalPriceDecimal = totalPriceDecimal.plus(usage.totalPrice);
        sawPrice = true;
      }
      if (typeof usage.currentContext === 'number') {
        currentContext = Math.max(currentContext, usage.currentContext);
        sawContext = true;
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
      ...(sawPrice ? { totalPrice: totalPriceDecimal.toNumber() } : {}),
      ...(sawContext ? { currentContext } : {}),
    };
  }

  /**
   * Extract token usage and cost from LangChain's ChatOpenAI response.
   * Automatically recalculates price when cached or reasoning tokens are present.
   *
   * @param args.model - Model name for price lookup
   * @param args.usage_metadata - LangChain usage metadata
   * @param args.response_metadata - LangChain response metadata
   * @returns Token usage with accurate cost calculation
   */
  async extractTokenUsageFromResponse(
    model: string,
    usageMetadata?: UsageMetadata,
  ): Promise<RequestTokenUsage | null> {
    const inputTokens =
      usageMetadata?.input_tokens ?? usageMetadata?.prompt_tokens ?? 0;
    const outputTokens =
      usageMetadata?.output_tokens ?? usageMetadata?.completion_tokens ?? 0;

    const inputTokensDetails =
      usageMetadata?.input_tokens_details ||
      usageMetadata?.input_token_details ||
      usageMetadata?.prompt_tokens_details;
    const cachedInputTokens =
      inputTokensDetails?.cached_tokens ?? inputTokensDetails?.cache_read ?? 0;

    const outputTokensDetails =
      usageMetadata?.output_tokens_details ||
      usageMetadata?.completion_tokens_details;
    const reasoningTokens =
      outputTokensDetails?.reasoning_tokens ??
      outputTokensDetails?.reasoning ??
      0;

    const totalTokens = usageMetadata?.total_tokens ?? 0;

    const totalPrice = await this.estimateThreadTotalPriceFromModelRates({
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
    });

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      currentContext: inputTokens,
      cachedInputTokens,
      reasoningTokens,
      totalPrice: totalPrice || 0,
    };
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
    if (!entry) {
      return null;
    }

    // Helper to read number or string number
    const readNumish = (v: unknown): number | undefined => {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
      if (typeof v === 'string' && v.length > 0) {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : undefined;
      }
      return undefined;
    };

    const inputCostPerToken = readNumish(entry.input_cost_per_token);
    const outputCostPerToken = readNumish(entry.output_cost_per_token);
    if (inputCostPerToken === undefined || outputCostPerToken === undefined) {
      return null;
    }

    const inputCostPerCachedToken =
      readNumish(entry.input_cost_per_token_cache_hit) ??
      readNumish(entry.cache_read_input_token_cost);
    const outputCostPerReasoningToken = readNumish(
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
    if (!rates) {
      return null;
    }

    const cached = Math.max(0, args.cachedInputTokens ?? 0);
    const input = Math.max(0, args.inputTokens);
    const nonCached = Math.max(0, input - cached);
    const output = Math.max(0, args.outputTokens);
    const reasoning = Math.max(0, args.reasoningTokens ?? 0);

    const cachedRate = rates.inputCostPerCachedToken ?? rates.inputCostPerToken;
    const reasoningRate = rates.outputCostPerReasoningToken ?? 0;

    const inputCost = new Decimal(nonCached).times(rates.inputCostPerToken);
    const cachedCost = new Decimal(cached).times(cachedRate);
    const outputCost = new Decimal(output).times(rates.outputCostPerToken);
    const reasoningCost = new Decimal(reasoning).times(reasoningRate);

    return inputCost
      .plus(cachedCost)
      .plus(outputCost)
      .plus(reasoningCost)
      .toNumber();
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
