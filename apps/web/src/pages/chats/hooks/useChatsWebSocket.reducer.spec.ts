// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Capture useWebSocketEvent handlers so the test can drive them directly ────

type Handler = (payload: unknown) => void;
const wsHandlers = new Map<string, Handler>();

vi.mock('../../../hooks/useWebSocket', () => ({
  useWebSocketEvent: (eventType: string, handler: Handler) => {
    wsHandlers.set(eventType, handler);
  },
}));

vi.mock('../../../api', () => ({
  threadsApi: {
    getThreadByExternalId: vi.fn(),
    getThreadById: vi.fn(),
  },
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import type { ThreadTokenUsageSnapshot } from '../types';
import { useChatsWebSocket } from './useChatsWebSocket';

// ── Helpers ───────────────────────────────────────────────────────────────────

const THREAD_ID = 'thread-1';
const NODE_ID = 'node-1';
const GRAPH_ID = 'graph-1';

type UsageMap = Record<string, Record<string, ThreadTokenUsageSnapshot>>;

// Thin wrapper that mounts the real hook with stateful threadTokenUsageByNode so
// the test can observe reducer evolution.
const useHarness = () => {
  const [threadTokenUsageByNode, setThreadTokenUsageByNode] =
    useState<UsageMap>({});
  const threadsRef = useRef<never[]>([]);
  const pendingThreadSelectionRef = useRef<string | null>(null);

  useChatsWebSocket({
    graphFilterId: undefined,
    selectedThreadId: THREAD_ID,
    draftThread: null,
    threadsRef: threadsRef as never,
    pendingThreadSelectionRef,
    setThreads: vi.fn(),
    setSelectedThreadId: vi.fn(),
    setSelectedThreadShadow: vi.fn(),
    setDraftThread: vi.fn(),
    setExternalThreadIds: vi.fn(),
    setMessageMeta: vi.fn(),
    setThreadTokenUsageByNode,
    messages: {},
    pendingMessages: {},
    updateMessages: vi.fn(),
    updatePendingMessages: vi.fn(),
    externalThreadIds: {},
    sortThreadsByTimestampDesc: (list) => list,
    getThreadTimestamp: () => 0,
    ensureGraphsLoaded: async () => {},
    graphCache: {},
    setGraphCache: vi.fn(),
    invalidateThreadUsageStats: vi.fn(),
  });

  return threadTokenUsageByNode;
};

const agentMessage = (
  totalPrice: number,
  extra: Record<string, unknown> = {},
) => ({
  type: 'agent.message',
  internalThreadId: THREAD_ID,
  threadId: THREAD_ID,
  graphId: GRAPH_ID,
  nodeId: NODE_ID,
  data: {
    id: `msg-${Math.random()}`,
    threadId: THREAD_ID,
    externalThreadId: THREAD_ID,
    createdAt: new Date().toISOString(),
    nodeId: NODE_ID,
    message: {
      role: 'ai',
      content: 'hello',
      ...(extra.kwargs ? { additionalKwargs: extra.kwargs } : {}),
    },
    requestTokenUsage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      totalPrice,
    },
  },
});

const agentStateUpdate = (totalPrice: number, totalTokens: number) => ({
  type: 'agent.state.update',
  internalThreadId: THREAD_ID,
  threadId: THREAD_ID,
  graphId: GRAPH_ID,
  nodeId: NODE_ID,
  data: {
    inputTokens: Math.floor(totalTokens * 0.7),
    outputTokens: Math.ceil(totalTokens * 0.3),
    totalTokens,
    totalPrice,
    currentContext: totalTokens,
  },
});

describe('useChatsWebSocket — additive vs state.update reducer interaction', () => {
  beforeEach(() => {
    wsHandlers.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const dispatch = (type: string, payload: unknown) => {
    const fn = wsHandlers.get(type);
    if (!fn) {
      throw new Error(`No handler captured for ${type}`);
    }
    fn(payload);
  };

  const flushAgentMessageBatch = async () => {
    // flushAgentMessages is scheduled via setTimeout(fn, 0)
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
  };

  const totalPriceFor = (usageMap: UsageMap) =>
    usageMap[THREAD_ID]?.[NODE_ID]?.totalPrice;

  it('thread total must not drop when agent.state.update arrives after additive agent.message events', async () => {
    const { result } = renderHook(() => useHarness());

    // Step 1 — Parent LLM call completes, agent.message adds $0.10 additively.
    act(() => {
      dispatch('agent.message', agentMessage(0.1));
    });
    await flushAgentMessageBatch();
    expect(totalPriceFor(result.current)).toBeCloseTo(0.1, 10);

    // Step 2 — Checkpoint state.update arrives with cumulative totalPrice=$0.10.
    // With the current reducer this REPLACES the additive total (still $0.10,
    // no visible drop). But the authoritative-policy view is that state.update
    // should not touch additive fields at all. Sanity-check step 2.
    act(() => {
      dispatch('agent.state.update', agentStateUpdate(0.1, 15));
    });
    expect(totalPriceFor(result.current)).toBeCloseTo(0.1, 10);

    // Step 3 — Subagent completes, emits a subagent-flagged agent.message that
    // ALWAYS bypasses the nodeHasStateUpdates gate (useChatsWebSocket.ts:812).
    // Additively adds $0.02 — aggregate becomes $0.12.
    act(() => {
      dispatch(
        'agent.message',
        agentMessage(0.02, {
          kwargs: { __subagentCommunication: true },
        }),
      );
    });
    await flushAgentMessageBatch();
    expect(totalPriceFor(result.current)).toBeCloseTo(0.12, 10);

    // Step 4 — A new checkpoint state.update arrives BEFORE the parent's
    // checkpoint has folded in the subagent cost. Cumulative total $0.11
    // (parent $0.10 + new parent tool-call $0.01). Because the reducer spreads
    // this over the existing slot, it REPLACES totalPrice from $0.12 → $0.11,
    // which is the visible downward jump the user reports.
    act(() => {
      dispatch('agent.state.update', agentStateUpdate(0.11, 20));
    });

    // The invariant we care about: the aggregate MUST NEVER DECREASE during a
    // running thread. state.update should be informational for currentContext
    // only and must not overwrite additive totals.
    expect(totalPriceFor(result.current)).toBeGreaterThanOrEqual(0.12 - 1e-9);
  });
});
