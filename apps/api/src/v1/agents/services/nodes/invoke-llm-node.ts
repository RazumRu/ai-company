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
    this.logger?.debug('invoke-llm-node.invoke.start', {
      toolNames: this.tools.map((tool) => tool.name),
      messageCount: state.messages.length,
      hasSummary: Boolean(state.summary),
    });

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

    this.logger?.debug('invoke-llm-node.invoke.messages', {
      totalMessages: messages.length,
      lastMessageType: messages.at(-1)?.constructor.name,
    });

    const res = await runner.invoke(messages, { recursionLimit: 2500 });
    const out: BaseMessage[] = Array.isArray(res) ? res : [res as BaseMessage];

    const first = out[0];
    const toolCalls = (first as any)?.tool_calls || [];
    this.logger?.debug('invoke-llm-node.invoke.complete', {
      responseType: first?.constructor?.name,
      toolCallCount: toolCalls.length,
      toolCallNames: toolCalls.map((call: any) => call.name),
    });

    return { messages: { mode: 'append', items: out } };
  }
}
