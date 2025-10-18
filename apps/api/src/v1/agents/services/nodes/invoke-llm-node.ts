import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { BaseNode } from './base-node';

type InvokeLlmNodeOpts = {
  systemPrompt?: string;
  toolChoice?: 'auto' | 'required';
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

  async invoke(state: BaseAgentState): Promise<BaseAgentStateChange> {
    const runner = this.llm.bindTools(this.tools, {
      tool_choice: this.opts?.toolChoice,
      parallel_tool_calls: this.opts?.parallelToolCalls,
    });

    const messages: BaseMessage[] = [
      new SystemMessage(
        this.opts?.systemPrompt || 'You are a helpful AI assistant.',
      ),
      ...(state.summary
        ? [new SystemMessage(`Summary:\n${state.summary}`)]
        : []),
      ...state.messages,
    ];

    const res = await runner.invoke(messages, { recursionLimit: 2500 });
    const out: BaseMessage[] = Array.isArray(res) ? res : [res as BaseMessage];

    return { messages: { mode: 'append', items: out } };
  }
}
