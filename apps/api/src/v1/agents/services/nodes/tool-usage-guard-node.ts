import { AIMessage, SystemMessage } from '@langchain/core/messages';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { BaseNode } from './base-node';

type RestrictGetters = {
  getRestrictOutput: () => boolean;
  getRestrictionMessage: () => string;
  getRestrictionMaxInjections: () => number;
};

export class ToolUsageGuardNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(private readonly g: RestrictGetters) {
    super();
  }

  async invoke(state: BaseAgentState): Promise<BaseAgentStateChange> {
    if (!this.g.getRestrictOutput()) {
      return {
        messages: { mode: 'append', items: [] },
        summary: state.summary,
        done: state.done,
      };
    }

    const last = state.messages[state.messages.length - 1];
    const lastAI = last instanceof AIMessage ? last : undefined;
    const hasToolCalls = (lastAI?.tool_calls?.length || 0) > 0;
    if (hasToolCalls) {
      return {
        messages: { mode: 'append', items: [] },
        summary: state.summary,
        done: state.done,
      };
    }

    const max = this.g.getRestrictionMaxInjections();
    const injectedSoFar = state.toolUsageGuardActivatedCount ?? 0;
    const canInject = max === 0 || injectedSoFar < max;
    if (!canInject) {
      return {
        messages: { mode: 'append', items: [] },
        summary: state.summary,
        done: state.done,
      };
    }

    const msg = new SystemMessage({
      content: this.g.getRestrictionMessage(),
    });
    return {
      messages: { mode: 'append', items: [msg] },
      toolUsageGuardActivatedCount: injectedSoFar + 1,
      toolUsageGuardActivated: true,
    };
  }
}
