import { encodingForModel, getEncoding } from '@langchain/core/utils/tiktoken';
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import { environment } from '../../../environments';
import { LiteLlmModelDto } from '../dto/models.dto';
import {
  LiteLLMModelInfo,
  LLMTokenCostRates,
  RequestTokenUsage,
  UsageMetadata,
} from '../litellm.types';
import { LiteLlmClient } from './litellm.client';

@Injectable()
export class LitellmService {
  private static readonly MODEL_INFO_TTL_MS = 12 * 60 * 60 * 1000; // 12h

  private modelInfoCache = new Map<
    string,
    { expiresAt: number; data: LiteLLMModelInfo }
  >();
  private modelInfoInFlight = new Map<
    string,
    Promise<LiteLLMModelInfo | null>
  >();

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

    const totalPrice = this.isOfflineModel(model)
      ? 0
      : await this.estimateThreadTotalPriceFromModelRates({
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
  ): Promise<LLMTokenCostRates | null> {
    const entry = await this.getLiteLLMModelInfo(model);
    const modelInfo = entry?.model_info ?? null;
    if (!modelInfo) {
      return null;
    }

    const inputCostPerToken = Number(modelInfo.input_cost_per_token);
    const outputCostPerToken = Number(modelInfo.output_cost_per_token);
    if (isNaN(inputCostPerToken) || isNaN(outputCostPerToken)) {
      return null;
    }

    const inputCostPerCachedToken = Number(
      modelInfo.input_cost_per_token_cache_hit ??
        modelInfo.cache_read_input_token_cost,
    );
    const outputCostPerReasoningToken = Number(
      modelInfo.output_cost_per_reasoning_token,
    );

    return {
      inputCostPerToken,
      outputCostPerToken,
      ...(!isNaN(inputCostPerCachedToken) ? { inputCostPerCachedToken } : {}),
      ...(!isNaN(outputCostPerReasoningToken)
        ? { outputCostPerReasoningToken }
        : {}),
    };
  }

  async supportsResponsesApi(model: string): Promise<boolean> {
    const entry = await this.getLiteLLMModelInfo(model);
    if (!entry) {
      return true;
    }

    return !!entry.model_info?.supports_response_schema;
  }

  async supportsReasoning(model: string): Promise<boolean> {
    const entry = await this.getLiteLLMModelInfo(model);
    if (!entry) {
      return true;
    }

    return !!entry.model_info?.supports_reasoning;
  }

  async supportsParallelToolCall(model: string): Promise<boolean> {
    const entry = await this.getLiteLLMModelInfo(model);
    if (!entry) {
      return true;
    }

    return !!entry.model_info?.supports_parallel_function_calling;
  }

  async supportsStreaming(model: string): Promise<boolean> {
    const entry = await this.getLiteLLMModelInfo(model);
    if (!entry) {
      return true;
    }

    return !!entry.model_info?.supports_native_streaming;
  }

  async estimateThreadTotalPriceFromModelRates(args: {
    model: string;
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
    reasoningTokens?: number;
  }): Promise<number | null> {
    if (this.isOfflineModel(args.model)) {
      return 0;
    }
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

  private async getLiteLLMModelInfo(
    model: string,
  ): Promise<LiteLLMModelInfo | null> {
    if (!model) {
      return null;
    }

    const now = Date.now();
    const cached = this.modelInfoCache.get(model);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const inFlight = this.modelInfoInFlight.get(model);
    if (inFlight) {
      return inFlight;
    }

    const promise = (async () => {
      const entry = await this.liteLlmClient.getModelInfo(model);
      if (!entry) {
        return null;
      }
      this.modelInfoCache.set(model, {
        expiresAt: Date.now() + LitellmService.MODEL_INFO_TTL_MS,
        data: entry,
      });
      return entry;
    })().finally(() => {
      this.modelInfoInFlight.delete(model);
    });

    this.modelInfoInFlight.set(model, promise);
    return promise;
  }

  private isOfflineModel(model: string): boolean {
    if (!model || !environment.llmUseOfflineModel) {
      return false;
    }

    const normalized = model.toLowerCase();
    const configured = [
      environment.llmOfflineGeneralModel,
      environment.llmOfflineCodingModel,
      environment.llmOfflineEmbeddingModel,
    ].map((value) => value.toLowerCase());

    if (configured.includes(normalized)) {
      return true;
    }

    const normalizedShort = normalized.includes('/')
      ? normalized.split('/').pop()
      : normalized;

    return configured.some((value) => {
      const configuredShort = value.includes('/')
        ? value.split('/').pop()
        : value;
      return normalizedShort === configuredShort;
    });
  }
}
