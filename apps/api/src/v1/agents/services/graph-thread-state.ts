import { BaseMessage } from '@langchain/core/messages';

import { NewMessageMode } from '../agents.types';

export interface IGraphThreadStateData {
  pendingMessages: BaseMessage[];
  newMessageMode: NewMessageMode;
}

export class GraphThreadState {
  private stateByThread = new Map<string, IGraphThreadStateData>();

  private getDefaultState(): IGraphThreadStateData {
    return {
      pendingMessages: [],
      newMessageMode: NewMessageMode.InjectAfterToolCall,
    };
  }

  public getByThread(threadId: string): IGraphThreadStateData {
    return this.stateByThread.get(threadId) || this.getDefaultState();
  }

  public applyForThread(
    threadId: string,
    state: Partial<IGraphThreadStateData>,
  ): IGraphThreadStateData {
    const newState = {
      ...this.getByThread(threadId),
      ...state,
    };
    this.stateByThread.set(threadId, newState);

    return newState;
  }
}
