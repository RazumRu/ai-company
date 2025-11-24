import { BaseMessage, ChatMessage } from '@langchain/core/messages';

import { NewMessageMode } from '../agents.types';

export interface IGraphThreadStateData {
  pendingMessages: BaseMessage[];
  newMessageMode: NewMessageMode;
  reasoningChunks: Map<string, ChatMessage>;
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
      reasoningChunks: new Map(),
    };
  }

  private cloneState(state: IGraphThreadStateData): IGraphThreadStateData {
    const reasoningChunksCopy = new Map<string, ChatMessage>();

    for (const [key, value] of state.reasoningChunks) {
      const msgClone = Object.assign(
        Object.create(Object.getPrototypeOf(value)),
        value,
      );
      reasoningChunksCopy.set(key, msgClone);
    }

    return {
      pendingMessages: [...state.pendingMessages],
      newMessageMode: state.newMessageMode,
      reasoningChunks: reasoningChunksCopy,
    };
  }

  public getByThread(threadId: string): IGraphThreadStateData {
    const state = this.stateByThread.get(threadId) ?? this.getDefaultState();
    return this.cloneState(state);
  }

  public subscribe(subscriber: GraphThreadStateSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  public applyForThread(
    threadId: string,
    patch: Partial<IGraphThreadStateData>,
  ): IGraphThreadStateData {
    const prevState =
      this.stateByThread.get(threadId) ?? this.getDefaultState();

    const nextState: IGraphThreadStateData = {
      pendingMessages: patch.pendingMessages ?? prevState.pendingMessages,
      newMessageMode: patch.newMessageMode ?? prevState.newMessageMode,
      reasoningChunks: patch.reasoningChunks ?? prevState.reasoningChunks,
    };

    if (!this.hasStateChanged(prevState, nextState)) {
      return prevState;
    }

    this.stateByThread.set(threadId, nextState);

    const safePrev = this.cloneState(prevState);
    const safeNext = this.cloneState(nextState);

    this.notifySubscribers(threadId, safeNext, safePrev);

    return nextState;
  }

  private hasStateChanged(
    prev: IGraphThreadStateData,
    next: IGraphThreadStateData,
  ): boolean {
    return (
      prev.newMessageMode !== next.newMessageMode ||
      prev.pendingMessages !== next.pendingMessages ||
      prev.reasoningChunks !== next.reasoningChunks
    );
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
        //
      }
    }
  }
}
