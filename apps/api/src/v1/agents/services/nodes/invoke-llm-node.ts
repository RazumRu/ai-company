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

    const res = await runner.invoke(messages);

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
      ...(threadUsage || {}),
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

  private getAnsweredToolCallNames(messages: BaseMessage[]): string[] | null {
    // Find the most recent AI message that called tools, and ensure at least one
    // tool result message exists after it (before the next AI message).
    // We only persist tool NAMES for analytics (not call ids).
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!(msg instanceof AIMessage)) continue;

      const toolNames = this.getToolCallNamesFromAiMessage(msg);
      if (toolNames.length === 0) continue;

      const stopAt = (() => {
        for (let j = i + 1; j < messages.length; j++) {
          if (messages[j] instanceof AIMessage) return j;
        }
        return messages.length;
      })();

      const hasAnyToolResult = messages
        .slice(i + 1, stopAt)
        .some((m) => m.type === 'tool');
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
}
