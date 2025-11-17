import { BaseMessage } from '@langchain/core/messages';

import { NewMessageMode } from '../agents.types';

export interface IGraphThreadStateData {
  pendingMessages: BaseMessage[];
  newMessageMode: NewMessageMode;
}

type GraphThreadStateSubscriber = (
  threadId: string,
  nextState: IGraphThreadStateData,
  previousState?: IGraphThreadStateData,
) => void;

export class GraphThreadState {
  private stateByThread = new Map<string, IGraphThreadStateData>();
  private subscribers = new Set<GraphThreadStateSubscriber>();

  private getDefaultState(): IGraphThreadStateData {
    return {
      pendingMessages: [],
      newMessageMode: NewMessageMode.InjectAfterToolCall,
    };
  }

  public getByThread(threadId: string): IGraphThreadStateData {
    return this.stateByThread.get(threadId) || this.getDefaultState();
  }

  public subscribe(subscriber: GraphThreadStateSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  public applyForThread(
    threadId: string,
    state: Partial<IGraphThreadStateData>,
  ): IGraphThreadStateData {
    const prevState = this.stateByThread.get(threadId);
    const newState = {
      ...this.getByThread(threadId),
      ...state,
    };
    this.stateByThread.set(threadId, newState);

    this.notifySubscribers(threadId, newState, prevState);

    return newState;
  }

  private notifySubscribers(
    threadId: string,
    nextState: IGraphThreadStateData,
    prevState?: IGraphThreadStateData,
  ) {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(threadId, nextState, prevState);
      } catch {
        // Ignore subscriber errors to avoid breaking state updates
      }
    }
  }
}
