import { HumanMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentState, NewMessageMode } from '../../agents.types';
import { GraphThreadState } from '../graph-thread-state';
import { InjectPendingNode } from './inject-pending-node';

describe('InjectPendingNode', () => {
  let node: InjectPendingNode;
  let graphThreadState: GraphThreadState;

  const baseState: BaseAgentState = {
    messages: [],
    summary: '',
    done: false,
    needsMoreInfo: false,
    toolUsageGuardActivated: false,
    toolUsageGuardActivatedCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    totalPrice: 0,
    currentContext: 0,
  };

  const cfg = {
    configurable: {
      thread_id: 'thread-1',
      run_id: 'run-1',
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    graphThreadState = new GraphThreadState();
    node = new InjectPendingNode(graphThreadState);
  });

  it('should return empty change when no pending messages', async () => {
    const result = await node.invoke(baseState, cfg);
    expect(result).toEqual({});
  });

  it('should consume pending messages from the thread state', async () => {
    const message = new HumanMessage('pending');
    graphThreadState.applyForThread('thread-1', { pendingMessages: [message] });

    const result = await node.invoke(baseState, cfg);
    expect(result.messages?.items).toHaveLength(1);
    expect(
      graphThreadState.getByThread('thread-1').pendingMessages,
    ).toHaveLength(0);
    expect(result.done).toBe(false);
    expect(result.needsMoreInfo).toBe(false);
    expect(result.toolUsageGuardActivated).toBe(false);
    expect(result.toolUsageGuardActivatedCount).toBe(0);
  });

  it('should defer wait_for_completion messages until done or needsMoreInfo', async () => {
    const message = new HumanMessage('pending');
    graphThreadState.applyForThread('thread-1', {
      pendingMessages: [message],
      newMessageMode: NewMessageMode.WaitForCompletion,
    });

    const resultBefore = await node.invoke(baseState, cfg);
    expect(resultBefore).toEqual({});

    const doneState: BaseAgentState = {
      ...baseState,
      done: true,
    };

    const resultAfter = await node.invoke(doneState, cfg);
    expect(resultAfter.messages?.items).toHaveLength(1);
    expect(
      graphThreadState.getByThread('thread-1').pendingMessages,
    ).toHaveLength(0);
  });

  it('should inject wait_for_completion messages when needsMoreInfo is true', async () => {
    const pending = new HumanMessage('pending');
    graphThreadState.applyForThread('thread-1', {
      pendingMessages: [pending],
      newMessageMode: NewMessageMode.WaitForCompletion,
    });

    const state: BaseAgentState = {
      ...baseState,
      needsMoreInfo: true,
    };

    const result = await node.invoke(state, cfg);
    expect(result.messages?.items).toHaveLength(1);
    expect(result.done).toBe(false);
    expect(result.needsMoreInfo).toBe(false);
  });
});
