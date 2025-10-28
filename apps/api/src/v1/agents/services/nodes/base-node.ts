import { LangGraphRunnableConfig } from '@langchain/langgraph';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { BaseAgent } from '../agents/base-agent';

export type BaseAgentConfigurable = {
  thread_id?: string;
  caller_agent?: BaseAgent<any>;
  graph_id?: string;
  node_id?: string;
  checkpoint_ns?: string;
  parent_thread_id?: string;
  source?: string;
};

export abstract class BaseNode<
  I extends BaseAgentState,
  O extends BaseAgentStateChange,
> {
  public abstract invoke(
    state: I,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<O>;
}
