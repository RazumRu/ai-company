import { ChatMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';

import { NewMessageMode } from '../agents.types';
import { GraphThreadState } from './graph-thread-state';

describe('GraphThreadState', () => {
  it('emits updates only when pending messages reference changes', () => {
    const graphState = new GraphThreadState();
    const subscriber = vi.fn();
    const unsubscribe = graphState.subscribe(subscriber);

    const initialMessages = [new HumanMessage('hello there')];

    const storedState = graphState.applyForThread('thread-1', {
      pendingMessages: initialMessages,
    });

    expect(subscriber).toHaveBeenCalledTimes(1);

    graphState.applyForThread('thread-1', {
      pendingMessages: storedState.pendingMessages,
    });

    expect(subscriber).toHaveBeenCalledTimes(1);

    graphState.applyForThread('thread-1', {
      pendingMessages: [...storedState.pendingMessages],
    });

    expect(subscriber).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('emits updates when reasoning chunks or message mode change', () => {
    const graphState = new GraphThreadState();
    const subscriber = vi.fn();
    graphState.subscribe(subscriber);

    const reasoningChunks = new Map<string, ChatMessage>();
    reasoningChunks.set('reasoning:1', new ChatMessage('partial', 'reasoning'));

    graphState.applyForThread('thread-2', { reasoningChunks });

    expect(subscriber).toHaveBeenCalledTimes(1);

    graphState.applyForThread('thread-2', { reasoningChunks });

    expect(subscriber).toHaveBeenCalledTimes(1);

    const updatedReasoning = new Map(reasoningChunks);
    updatedReasoning.set(
      'reasoning:1',
      new ChatMessage('partial+more', 'reasoning'),
    );

    graphState.applyForThread('thread-2', {
      reasoningChunks: updatedReasoning,
    });

    expect(subscriber).toHaveBeenCalledTimes(2);

    graphState.applyForThread('thread-2', {
      newMessageMode: NewMessageMode.WaitForCompletion,
    });

    expect(subscriber).toHaveBeenCalledTimes(3);

    graphState.applyForThread('thread-2', {
      newMessageMode: NewMessageMode.WaitForCompletion,
    });

    expect(subscriber).toHaveBeenCalledTimes(3);
  });
});
