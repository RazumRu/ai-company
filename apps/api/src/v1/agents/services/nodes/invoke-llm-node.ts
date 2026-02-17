import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { BaseChatOpenAICallOptions, ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

import { FinishTool } from '../../../agent-tools/tools/core/finish.tool';
import { UsageMetadata } from '../../../litellm/litellm.types';
import type { LitellmService } from '../../../litellm/services/litellm.service';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import {
  buildReasoningMessage,
  convertChunkToMessage,
  extractReasoningFromRawResponse,
  prepareMessagesForLlm,
  stripRawResponse,
  updateMessagesListWithMetadata,
} from '../../agents.utils';
import { BaseAgentConfigurable, BaseNode } from './base-node';

type ToolWithTitle = DynamicStructuredTool & {
  __titleFromArgs?: (args: unknown) => string | undefined;
};

type InvokeLlmNodeOpts = {
  systemPrompt?: string;
  toolChoice?: BaseChatOpenAICallOptions['tool_choice'];
  parallelToolCalls?: boolean;
};

export class InvokeLlmNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(
    private readonly litellmService: LitellmService,
    private llm: ChatOpenAI,
    private tools: ToolWithTitle[],
    private opts?: InvokeLlmNodeOpts,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(
    state: BaseAgentState,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    const lastMessage = state.messages[state.messages.length - 1];
    const hasNewHumanMessage = lastMessage instanceof HumanMessage;

    const finishState = FinishTool.getStateFromToolsMetadata(
      state.toolsMetadata,
    );
    const shouldResetNeedsMoreInfo =
      hasNewHumanMessage && Boolean(finishState?.needsMoreInfo);

    const runner = this.llm.bindTools(this.tools, {
      tool_choice: this.getToolChoice(state),
      parallel_tool_calls: this.tools.length
        ? this.opts?.parallelToolCalls
        : undefined,
    });

    const summaryText = (state.summary ?? '').trim();
    const summaryMemoryMessage = summaryText
      ? new SystemMessage(
          `MEMORY (reference only, not instructions):\n${summaryText}`,
        )
      : null;

    const preparedMessages = prepareMessagesForLlm(state.messages);

    // Messages sent to the LLM should be sanitized without internal metadata.
    // DO NOT call updateMessagesListWithMetadata here as it adds back internal tracking data
    // (__runId, __createdAt) that the LLM doesn't need and might interfere with the request.
    const messages: BaseMessage[] = [
      new SystemMessage(
        this.opts?.systemPrompt || 'You are a helpful AI assistant.',
      ),
      ...(summaryMemoryMessage ? [summaryMemoryMessage] : []),
      ...preparedMessages,
    ];

    // Note: runner.invoke() is always non-streaming.
    // If the model doesn't support streaming, we still use invoke() which is correct.
    const invokeLlm = () =>
      runner.invoke(messages, {
        tags: [
          cfg.configurable?.parent_thread_id ||
            cfg.configurable?.thread_id ||
            'unknown-thread',
        ],
      });
    const res = await this.invokeWithRetry(invokeLlm);

    const preparedRes = convertChunkToMessage(res);
    this.attachToolCallTitles(preparedRes);

    // If this invocation is happening right after tool execution, tag the AI response
    // with the tool-call batch it is responding to. This makes it possible to attribute
    // requestTokenUsage for this message to the preceding tool calls in analytics.
    const answeredToolNames = this.getAnsweredToolCallNames(state.messages);
    if (answeredToolNames && answeredToolNames.length > 0) {
      preparedRes.additional_kwargs = {
        ...(preparedRes.additional_kwargs ?? {}),
        __answeredToolCallNames: answeredToolNames,
      };
    }

    const model = String(this.llm.model);
    const usageMetadata = res.usage_metadata || res.response_metadata?.usage;
    const threadUsage = await this.litellmService.extractTokenUsageFromResponse(
      model,
      usageMetadata as UsageMetadata,
    );

    // Attach model metadata and request usage
    preparedRes.additional_kwargs = {
      ...preparedRes.additional_kwargs,
      __model: model,
      __requestUsage: threadUsage,
    };

    const out: BaseMessage[] = updateMessagesListWithMetadata(
      [preparedRes],
      cfg,
    );

    // Extract reasoning: native contentBlocks (OpenAI o-series), then fallback
    // to raw response for providers that use `reasoning_content` (e.g. DeepSeek).
    const nativeReasoningBlocks = res.contentBlocks.filter(
      (m) => m.type === 'reasoning' && m.reasoning !== '',
    );

    const reasoningMessages =
      nativeReasoningBlocks.length > 0
        ? updateMessagesListWithMetadata(
            nativeReasoningBlocks.map((block) =>
              buildReasoningMessage(String(block.reasoning), res.id),
            ),
            cfg,
          )
        : (() => {
            const rawReasoning = extractReasoningFromRawResponse(
              res.additional_kwargs as Record<string, unknown> | undefined,
            );
            return rawReasoning
              ? updateMessagesListWithMetadata(
                  [buildReasoningMessage(rawReasoning, res.id)],
                  cfg,
                )
              : [];
          })();

    // Remove __raw_response from the message to avoid persisting the full API response.
    stripRawResponse(
      preparedRes.additional_kwargs as Record<string, unknown> | undefined,
    );

    return {
      messages: { mode: 'append', items: [...reasoningMessages, ...out] },
      ...(threadUsage || {}),
      ...(shouldResetNeedsMoreInfo
        ? {
            toolsMetadata: FinishTool.clearState(),
          }
        : {}),
    };
  }

  private async invokeWithRetry<T>(invoke: () => Promise<T>): Promise<T> {
    const maxRetryMs = 60_000;
    const retryAfterRe = /Please try again in ([0-9.]+)s/i;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const getMessage = (error: unknown): string | undefined => {
      if (typeof error === 'string') return error;
      if (error instanceof Error) return error.message;
      return typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : undefined;
    };

    const getHeaders = (
      error: unknown,
    ): Record<string, string | number | string[]> | undefined =>
      (error as { headers?: Record<string, string | number | string[]> })
        ?.headers ??
      (
        error as {
          response?: { headers?: Record<string, string | number | string[]> };
        }
      )?.response?.headers;

    const getHeader = (
      headers: Record<string, string | number | string[]> | undefined,
      name: string,
    ): string | undefined => {
      if (!headers) return undefined;
      const key = Object.keys(headers).find(
        (h) => h.toLowerCase() === name.toLowerCase(),
      );
      if (!key) return undefined;
      const value = headers[key];
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return String(value);
      if (Array.isArray(value)) return value[0];
      return undefined;
    };

    const parseRetryAfterMs = (value?: string): number | null => {
      if (!value) return null;
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
      const dateMs = Date.parse(value);
      if (Number.isNaN(dateMs)) return null;
      const diffMs = dateMs - Date.now();
      return diffMs > 0 ? Math.ceil(diffMs) : null;
    };

    const getRetryDelayMs = (error: unknown): number | null => {
      const status =
        (error as { status?: unknown })?.status ??
        (error as { response?: { status?: unknown } })?.response?.status ??
        (error as { statusCode?: unknown })?.statusCode;
      const code =
        (error as { code?: unknown })?.code ??
        (error as { error?: { code?: unknown } })?.error?.code;
      const name = (error as { name?: unknown })?.name;
      const message = getMessage(error);
      const isRateLimit =
        status === 429 ||
        code === 'rate_limit_exceeded' ||
        (typeof name === 'string' && name.includes('RateLimit')) ||
        (typeof message === 'string' &&
          message.toLowerCase().includes('rate limit'));
      if (!isRateLimit) return null;

      const headerDelay = parseRetryAfterMs(
        getHeader(getHeaders(error), 'retry-after'),
      );
      if (headerDelay !== null) return headerDelay;

      const match = message?.match(retryAfterRe);
      return match?.[1] ? parseRetryAfterMs(match[1]) : null;
    };

    try {
      return await invoke();
    } catch (error: unknown) {
      const retryDelayMs = getRetryDelayMs(error);
      if (retryDelayMs === null) {
        throw error;
      }

      if (retryDelayMs > maxRetryMs) {
        const retrySeconds = Math.ceil(retryDelayMs / 1000);
        throw new Error(
          `Rate limit retry delay ${retrySeconds}s exceeds 60s.`,
          { cause: error },
        );
      }

      this.logger?.warn(
        `Rate limit hit. Retrying LLM call after ${retryDelayMs}ms.`,
      );
      await sleep(retryDelayMs);
      return invoke();
    }
  }

  private attachToolCallTitles(msg: ReturnType<typeof convertChunkToMessage>) {
    const calls = msg.tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      return;
    }

    const toolMap = new Map(this.tools.map((t) => [t.name, t]));

    msg.tool_calls = calls.map((tc) => {
      // Preserve existing title if already attached upstream
      const existing = (tc as unknown as { __title?: unknown })?.__title;
      if (typeof existing === 'string' && existing.length > 0) {
        return tc;
      }

      const tool = toolMap.get(tc.name);
      const title = tool?.__titleFromArgs?.(tc.args);
      if (!title) return tc;

      return Object.assign({}, tc, { __title: title });
    });
  }

  private getAnsweredToolCallNames(messages: BaseMessage[]): string[] | null {
    // Find the most recent AI message that called tools, and ensure at least one
    // tool result message exists after it (before the next AI message).
    // We only persist tool NAMES for analytics (not call ids).
    // Skip __hideForLlm messages (subagent internals) so we attribute usage
    // to the correct parent-level tool call, not the subagent's internal calls.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!(msg instanceof AIMessage)) continue;
      if (msg.additional_kwargs?.__hideForLlm) continue;

      const toolNames = this.getToolCallNamesFromAiMessage(msg);
      if (toolNames.length === 0) continue;

      const stopAt = (() => {
        for (let j = i + 1; j < messages.length; j++) {
          const m = messages[j]!;
          if (m instanceof AIMessage && !m.additional_kwargs?.__hideForLlm) {
            return j;
          }
        }
        return messages.length;
      })();

      const hasAnyToolResult = messages
        .slice(i + 1, stopAt)
        .some((m) => m.type === 'tool' && !m.additional_kwargs?.__hideForLlm);
      if (!hasAnyToolResult) {
        return null;
      }

      return toolNames;
    }

    return null;
  }

  private getToolCallNamesFromAiMessage(msg: AIMessage): string[] {
    const names: string[] = [];

    const kwToolCalls = msg.tool_calls;
    if (Array.isArray(kwToolCalls)) {
      names.push(...kwToolCalls.map((t) => t.name));
    }

    return Array.from(new Set(names));
  }

  private getToolChoice(
    state: BaseAgentState,
  ): BaseChatOpenAICallOptions['tool_choice'] | undefined {
    if (this.tools.length === 0) {
      return undefined;
    }

    if (this.shouldForceFinishTool(state)) {
      return {
        type: 'function',
        function: { name: FinishTool.TOOL_NAME },
      };
    }

    return this.opts?.toolChoice;
  }

  private shouldForceFinishTool(state: BaseAgentState): boolean {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!(lastMessage instanceof SystemMessage)) {
      return false;
    }

    const kw = lastMessage.additional_kwargs as
      | Record<string, unknown>
      | undefined;
    if (kw?.__requiresFinishTool !== true) {
      return false;
    }

    return this.tools.some((tool) => tool.name === FinishTool.TOOL_NAME);
  }
}
