import { AIMessage, SystemMessage } from '@langchain/core/messages';
import { DefaultLogger } from '@packages/common';

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
  constructor(
    private readonly g: RestrictGetters,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(state: BaseAgentState): Promise<BaseAgentStateChange> {
    this.logger?.debug('tool-usage-guard.invoke', {
      messageCount: state.messages.length,
      injectedCount: state.toolUsageGuardActivatedCount ?? 0,
    });

    if (!this.g.getRestrictOutput()) {
      this.logger?.debug('tool-usage-guard.allow-output');
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
      this.logger?.debug('tool-usage-guard.skip-has-tool-calls');
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
      this.logger?.debug('tool-usage-guard.max-injections', {
        max,
        injectedSoFar,
      });
      return {
        messages: { mode: 'append', items: [] },
        summary: state.summary,
        done: state.done,
      };
    }

    const restrictionMessage = this.g.getRestrictionMessage();
    this.logger?.debug('tool-usage-guard.inject-restriction', {
      restrictionMessage,
    });

    const msg = new SystemMessage({
      content: restrictionMessage,
    });
    return {
      messages: { mode: 'append', items: [msg] },
      toolUsageGuardActivatedCount: injectedSoFar + 1,
      toolUsageGuardActivated: true,
    };
  }
}
