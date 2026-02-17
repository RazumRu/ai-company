import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';

import { FinishTool } from '../../../agent-tools/tools/core/finish.tool';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { BaseAgentConfigurable, BaseNode } from './base-node';

type RestrictGetters = {
  getRestrictOutput: () => boolean;
  getRestrictionMessage: () => string;
  getRestrictionMaxInjections: () => number;
};

export class ToolUsageGuardNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(
    private readonly g: RestrictGetters,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(
    state: BaseAgentState,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    if (!this.g.getRestrictOutput()) {
      return { toolUsageGuardActivated: false };
    }

    const last = state.messages[state.messages.length - 1];
    const lastAI = last instanceof AIMessage ? last : undefined;
    const hasFinishToolCall =
      lastAI?.tool_calls?.some(
        (toolCall) => toolCall.name === FinishTool.TOOL_NAME,
      ) ?? false;

    if (hasFinishToolCall) {
      return { toolUsageGuardActivated: false };
    }

    const max = this.g.getRestrictionMaxInjections();
    const injectedSoFar = state.toolUsageGuardActivatedCount ?? 0;
    const canInject = max === 0 || injectedSoFar < max;

    if (!canInject) {
      this.logger?.warn(
        `Tool usage guard reached max injections (${max}); allowing graph to end without a tool call.`,
      );
      const terminalMsg = new SystemMessage({
        content:
          'Tool usage guard reached the maximum number of retries. The model returned an empty response without any tool calls, so this run is being ended to avoid an infinite loop. Please retry, or verify your model/provider supports tool calling for this configuration.',
      });
      terminalMsg.additional_kwargs = {
        ...(terminalMsg.additional_kwargs ?? {}),
        __hideForUi: true,
      };

      return {
        messages: {
          mode: 'append',
          items: updateMessagesListWithMetadata([terminalMsg], cfg),
        },
        toolsMetadata: FinishTool.setState({
          done: false,
          needsMoreInfo: true,
        }),
        toolUsageGuardActivated: false,
        // Keep the count as-is so the state reflects we hit the cap.
        toolUsageGuardActivatedCount: injectedSoFar,
      };
    }

    const restrictionMessage = this.g.getRestrictionMessage();

    const msg = new SystemMessage({
      content: restrictionMessage,
    });
    msg.additional_kwargs = {
      ...(msg.additional_kwargs ?? {}),
      __requiresFinishTool: true,
      __hideForSummary: true,
      __hideForUi: true,
    };
    return {
      messages: {
        mode: 'append',
        items: updateMessagesListWithMetadata([msg], cfg),
      },
      toolUsageGuardActivatedCount: injectedSoFar + 1,
      toolUsageGuardActivated: true,
    };
  }
}
