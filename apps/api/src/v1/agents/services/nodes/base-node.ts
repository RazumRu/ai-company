import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';

export abstract class BaseNode<
  I extends BaseAgentState,
  O extends BaseAgentStateChange,
> {
  public abstract invoke(state: I): Promise<O>;
}
