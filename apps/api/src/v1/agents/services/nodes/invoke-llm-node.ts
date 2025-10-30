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
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { BaseAgentConfigurable, BaseNode } from './base-node';

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
    private tools: DynamicStructuredTool[],
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
      tool_choice: this.opts?.toolChoice,
      parallel_tool_calls: this.opts?.parallelToolCalls,
    });

    const messages: BaseMessage[] = updateMessagesListWithMetadata(
      [
        new SystemMessage(
          this.opts?.systemPrompt || 'You are a helpful AI assistant.',
        ),
        ...(state.summary
          ? [new SystemMessage(`Summary:\n${state.summary}`)]
          : []),
        ...state.messages,
      ],
      cfg,
    );

    const res = await runner.invoke(messages, { recursionLimit: 2500 });
    const out: BaseMessage[] = updateMessagesListWithMetadata(
      Array.isArray(res) ? res : [res as BaseMessage],
      cfg,
    );

    return {
      messages: { mode: 'append', items: out },
      ...(shouldResetNeedsMoreInfo ? { needsMoreInfo: false } : {}),
    };
  }
}
