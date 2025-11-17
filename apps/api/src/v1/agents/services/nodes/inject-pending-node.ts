import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';

import {
  BaseAgentState,
  BaseAgentStateChange,
  NewMessageMode,
} from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { GraphThreadState } from '../graph-thread-state';
import { BaseAgentConfigurable, BaseNode } from './base-node';

export class InjectPendingNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(
    private readonly graphThreadState: GraphThreadState,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(
    state: BaseAgentState,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    const threadId = String(cfg.configurable?.thread_id ?? '');
    const threadState = this.graphThreadState.getByThread(threadId);

    const pending = threadState.pendingMessages;
    const mode =
      threadState.newMessageMode ?? NewMessageMode.InjectAfterToolCall;

    if (!pending.length) {
      return {};
    }

    const shouldInject =
      mode === NewMessageMode.WaitForCompletion
        ? state.done || state.needsMoreInfo
        : true;

    if (!shouldInject) {
      return {};
    }

    const updatedMessages = updateMessagesListWithMetadata(pending, cfg);

    this.graphThreadState.applyForThread(threadId, {
      pendingMessages: [],
    });

    return {
      messages: {
        mode: 'append',
        items: updatedMessages,
      },
      done: false,
      needsMoreInfo: false,
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
    };
  }
}
