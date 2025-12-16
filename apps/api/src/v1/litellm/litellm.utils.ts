import { estimateCost } from 'llm-cost';

import { TokenUsage } from './litellm.types';

function readNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function extractTokenUsageFromAdditionalKwargs(
  additionalKwargs?:
    | Record<string, unknown>
    | (Record<string, unknown> | null | undefined)[]
    | null,
): TokenUsage | null {
  const parseSingle = (
    single?: Record<string, unknown> | null,
  ): TokenUsage | null => {
    const maybe = single?.tokenUsage;
    if (!maybe || typeof maybe !== 'object') {
      return null;
    }

    const obj = maybe as Record<string, unknown>;

    const inputTokens = readNumber(obj.inputTokens);
    const outputTokens = readNumber(obj.outputTokens);
    const totalTokens = readNumber(obj.totalTokens);

    if (
      inputTokens === undefined ||
      outputTokens === undefined ||
      totalTokens === undefined
    ) {
      return null;
    }

    const cachedInputTokens = readNumber(obj.cachedInputTokens);
    const reasoningTokens = readNumber(obj.reasoningTokens);
    const totalPrice = readNumber(obj.totalPrice);

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
    return sumTokenUsages(additionalKwargs.map((kw) => parseSingle(kw)));
  }

  return parseSingle(additionalKwargs);
}

export function sumTokenUsages(
  usages: (TokenUsage | null | undefined)[],
): TokenUsage | null {
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
export function extractTokenUsageFromResponse(res: {
  usage_metadata?: unknown;
  response_metadata?: unknown;
  model?: string;
}): TokenUsage | null {
  const usageMetadata = res.usage_metadata;
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return null;
  }

  const usage = usageMetadata as Record<string, unknown>;

  const inputTokens = readNumber(usage.input_tokens) ?? 0;
  const outputTokens = readNumber(usage.output_tokens) ?? 0;

  const inputTokensDetails = usage.input_tokens_details;
  const cachedInputTokens =
    inputTokensDetails && typeof inputTokensDetails === 'object'
      ? readNumber(
          (inputTokensDetails as Record<string, unknown>).cached_tokens,
        )
      : undefined;

  const outputTokensDetails = usage.output_tokens_details;
  const reasoningTokens =
    outputTokensDetails && typeof outputTokensDetails === 'object'
      ? readNumber(
          (outputTokensDetails as Record<string, unknown>).reasoning_tokens,
        )
      : undefined;

  const totalTokens =
    readNumber(usage.total_tokens) ??
    inputTokens + outputTokens + (reasoningTokens ?? 0);

  // Prefer llm-cost for deterministic cost estimate (if model is known),
  // fall back to LiteLLM proxy metadata if present.
  const responseMetadata = res.response_metadata;
  let totalPrice: number | undefined;

  const model = res.model;
  if (typeof model === 'string' && model.length > 0) {
    const estimated = estimateCost({
      model,
      inputTokens,
      outputTokens,
    });
    totalPrice = readNumber(estimated);
  }

  if (responseMetadata && typeof responseMetadata === 'object') {
    const meta = responseMetadata as Record<string, unknown>;
    totalPrice ??=
      readNumber(meta.response_cost) ??
      readNumber(
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
