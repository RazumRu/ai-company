import { HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { GraphStatus } from '../graphs/graphs.types';
import { NotificationEvent, NotificationSchema } from './notifications.types';

describe('NotificationSchema', () => {
  it('parses a valid graph update event', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.Graph,
      graphId: 'graph-1',
      data: { status: GraphStatus.Running },
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid runtime.status event with phase fields', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.RuntimeStatus,
      graphId: 'graph-1',
      threadId: 'thread-1',
      nodeId: 'node-1',
      data: {
        runtimeId: 'inst-1',
        threadId: 'thread-1',
        nodeId: 'node-1',
        status: 'Starting',
        runtimeType: 'Docker',
        startingPhase: 'PullingImage',
        errorCode: null,
        lastError: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it('parses an agent.message with BaseMessage instances', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.AgentMessage,
      graphId: 'graph-1',
      nodeId: 'node-1',
      threadId: 'thread-1',
      parentThreadId: 'thread-0',
      data: { messages: [new HumanMessage('hello')] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent.message when messages are not BaseMessage instances', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.AgentMessage,
      graphId: 'graph-1',
      nodeId: 'node-1',
      threadId: 'thread-1',
      parentThreadId: 'thread-0',
      data: { messages: [{ content: 'plain object' }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects runtime.status with an unknown status value', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.RuntimeStatus,
      graphId: 'graph-1',
      data: {
        runtimeId: 'inst-1',
        threadId: 'thread-1',
        nodeId: 'node-1',
        status: 'Paused',
        runtimeType: 'Docker',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing graphId envelope field', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.Graph,
      data: { status: GraphStatus.Running },
    });
    expect(result.success).toBe(false);
  });

  it('rejects agent.state.update with non-numeric token fields', () => {
    const result = NotificationSchema.safeParse({
      type: NotificationEvent.AgentStateUpdate,
      graphId: 'graph-1',
      nodeId: 'node-1',
      threadId: 'thread-1',
      parentThreadId: 'thread-0',
      data: { totalTokens: 'fifty' },
    });
    expect(result.success).toBe(false);
  });
});
