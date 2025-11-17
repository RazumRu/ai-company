import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';

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
      return {};
    }

    const last = state.messages[state.messages.length - 1];
    const lastAI = last instanceof AIMessage ? last : undefined;
    const hasToolCalls = (lastAI?.tool_calls?.length || 0) > 0;

    if (hasToolCalls) {
      return {};
    }

    const max = this.g.getRestrictionMaxInjections();
    const injectedSoFar = state.toolUsageGuardActivatedCount ?? 0;
    const canInject = max === 0 || injectedSoFar < max;

    if (!canInject) {
      return {};
    }

    const restrictionMessage = this.g.getRestrictionMessage();

    const msg = new SystemMessage({
      content: restrictionMessage,
    });
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
