import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { BaseChatOpenAICallOptions, ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

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
    // Reset needsMoreInfo if there's a new human message in the state
    // Check if the last message is a human message (new user input)
    const lastMessage = state.messages[state.messages.length - 1];
    const hasNewHumanMessage = lastMessage instanceof HumanMessage;
    const shouldResetNeedsMoreInfo = hasNewHumanMessage && state.needsMoreInfo;

    const runner = this.llm.bindTools(this.tools, {
      tool_choice: this.tools.length ? this.opts?.toolChoice : undefined,
      parallel_tool_calls: this.tools.length
        ? this.opts?.parallelToolCalls
        : undefined,
    });

    const messages: BaseMessage[] = updateMessagesListWithMetadata(
      [
        new SystemMessage(
          this.opts?.systemPrompt || 'You are a helpful AI assistant.',
        ),
        ...(state.summary
          ? [new SystemMessage(`Summary:\n${state.summary}`)]
          : []),
        ...prepareMessagesForLlm(state.messages),
      ],
      cfg,
    );

    const res = await runner.invoke(messages);
    const preparedRes = convertChunkToMessage(res);
    this.attachToolCallTitles(preparedRes);
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
      ...(shouldResetNeedsMoreInfo ? { needsMoreInfo: false } : {}),
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
    }) as typeof calls;
  }
}
