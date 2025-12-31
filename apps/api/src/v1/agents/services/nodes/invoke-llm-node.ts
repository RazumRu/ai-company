import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { BaseChatOpenAICallOptions, ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

import { FinishTool } from '../../../agent-tools/tools/core/finish.tool';
import type { LitellmService } from '../../../litellm/services/litellm.service';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import {
  buildReasoningMessage,
  convertChunkToMessage,
  prepareMessagesForLlm,
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
      tool_choice: this.tools.length ? this.opts?.toolChoice : undefined,
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

    const messages: BaseMessage[] = updateMessagesListWithMetadata(
      [
        new SystemMessage(
          this.opts?.systemPrompt || 'You are a helpful AI assistant.',
        ),
        ...(summaryMemoryMessage ? [summaryMemoryMessage] : []),
        ...prepareMessagesForLlm(state.messages),
      ],
      cfg,
    );

    const res = await runner.invoke(messages);

    const preparedRes = convertChunkToMessage(res);
    this.attachToolCallTitles(preparedRes);

    const model = String(this.llm.model);
    const threadUsage =
      await this.litellmService.extractTokenUsageFromResponseWithPriceFallback({
        model,
        usage_metadata: res.usage_metadata,
        response_metadata: res.response_metadata,
      });

    // Attach token usage to this message using centralized method
    await this.litellmService.attachTokenUsageToMessage(preparedRes, model, {
      threadUsage,
      skipIfExists: false,
    });

    // Attach model metadata
    preparedRes.additional_kwargs = {
      ...preparedRes.additional_kwargs,
      __model: model,
    };

    const out: BaseMessage[] = updateMessagesListWithMetadata(
      [preparedRes],
      cfg,
    );

    const reasoningMessages = updateMessagesListWithMetadata(
      res.contentBlocks
        .filter((m) => m.type === 'reasoning' && m.reasoning !== '')
        .map((block) => {
          return buildReasoningMessage(String(block.reasoning), res.id);
        }),
      cfg,
    );

    return {
      messages: { mode: 'append', items: [...reasoningMessages, ...out] },
      ...(threadUsage
        ? {
            inputTokens: threadUsage.inputTokens,
            cachedInputTokens: threadUsage.cachedInputTokens ?? 0,
            outputTokens: threadUsage.outputTokens,
            reasoningTokens: threadUsage.reasoningTokens ?? 0,
            totalTokens: threadUsage.totalTokens,
            totalPrice: threadUsage.totalPrice ?? 0,
            // Snapshot of actual request context size, as reported by the provider.
            // This must represent what we *sent* to the LLM for this invocation.
            currentContext: threadUsage.inputTokens,
          }
        : {}),
      ...(shouldResetNeedsMoreInfo
        ? {
            toolsMetadata: FinishTool.clearState(),
          }
        : {}),
    };
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
}
