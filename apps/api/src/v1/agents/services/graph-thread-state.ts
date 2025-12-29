import { BaseMessage, ChatMessage } from '@langchain/core/messages';
import { DefaultLogger } from '@packages/common';

import { NewMessageMode } from '../agents.types';

export interface IGraphThreadStateData {
  pendingMessages: BaseMessage[];
  newMessageMode: NewMessageMode;
  reasoningChunks: Map<string, ChatMessage>;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  totalPrice: number;
  currentContext: number;
}

type GraphThreadStateSubscriber = (
  threadId: string,
  nextState: IGraphThreadStateData,
  previousState: IGraphThreadStateData,
) => void;

export class GraphThreadState {
  private stateByThread = new Map<string, IGraphThreadStateData>();
  private subscribers = new Set<GraphThreadStateSubscriber>();
  private logger?: DefaultLogger;

  constructor(logger?: DefaultLogger) {
    this.logger = logger;
  }

  private getDefaultState(): IGraphThreadStateData {
    return {
      pendingMessages: [],
      newMessageMode: NewMessageMode.InjectAfterToolCall,
      reasoningChunks: new Map(),
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    };
  }

  public getByThread(threadId: string): IGraphThreadStateData {
    return this.stateByThread.get(threadId) ?? this.getDefaultState();
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
      inputTokens: patch.inputTokens ?? prevState.inputTokens,
      cachedInputTokens: patch.cachedInputTokens ?? prevState.cachedInputTokens,
      outputTokens: patch.outputTokens ?? prevState.outputTokens,
      reasoningTokens: patch.reasoningTokens ?? prevState.reasoningTokens,
      totalTokens: patch.totalTokens ?? prevState.totalTokens,
      totalPrice: patch.totalPrice ?? prevState.totalPrice,
      currentContext: patch.currentContext ?? prevState.currentContext,
    };

    // No actual change - return previous state reference to avoid unnecessary updates
    if (this.isEqual(prevState, nextState)) {
      return prevState;
    }

    this.stateByThread.set(threadId, nextState);
    this.notifySubscribers(threadId, nextState, prevState);

    return nextState;
  }

  private isEqual(
    prev: IGraphThreadStateData,
    next: IGraphThreadStateData,
  ): boolean {
    return (
      prev.newMessageMode === next.newMessageMode &&
      prev.pendingMessages === next.pendingMessages &&
      prev.reasoningChunks === next.reasoningChunks &&
      prev.inputTokens === next.inputTokens &&
      prev.cachedInputTokens === next.cachedInputTokens &&
      prev.outputTokens === next.outputTokens &&
      prev.reasoningTokens === next.reasoningTokens &&
      prev.totalTokens === next.totalTokens &&
      prev.totalPrice === next.totalPrice &&
      prev.currentContext === next.currentContext
    );
  }

  private notifySubscribers(
    threadId: string,
    nextState: IGraphThreadStateData,
    prevState: IGraphThreadStateData,
  ) {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(threadId, nextState, prevState);
      } catch (error) {
        this.logger?.error(
          error as Error,
          'Error in GraphThreadState subscriber',
        );
      }
    }
  }
}
