import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { FinishTool } from '../../../agent-tools/tools/core/finish.tool';
import { ToolUsageGuardNode } from './tool-usage-guard-node';

describe('ToolUsageGuardNode', () => {
  it('deactivates itself once max injections is reached (prevents infinite loop)', async () => {
    const node = new ToolUsageGuardNode({
      getRestrictOutput: () => true,
      getRestrictionMessage: () => 'must call finish tool',
      getRestrictionMaxInjections: () => 3,
    });

    const change = await node.invoke(
      {
        messages: [new AIMessage({ content: '' })],
        summary: '',
        toolsMetadata: {},
        toolUsageGuardActivated: true,
        toolUsageGuardActivatedCount: 3,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      },
      { configurable: { run_id: 'run-1' } } as never,
    );

    expect(change.toolUsageGuardActivated).toBe(false);
  });

  it('injects a restriction message and activates when no finish tool is called', async () => {
    const restrictionMessage = 'must call finish tool';
    const node = new ToolUsageGuardNode({
      getRestrictOutput: () => true,
      getRestrictionMessage: () => restrictionMessage,
      getRestrictionMaxInjections: () => 3,
    });

    const change = await node.invoke(
      {
        messages: [new AIMessage({ content: '' })],
        summary: '',
        toolsMetadata: {},
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      },
      { configurable: { run_id: 'run-1' } } as never,
    );

    expect(change.toolUsageGuardActivated).toBe(true);
    expect(change.toolUsageGuardActivatedCount).toBe(1);
    expect(change.messages?.mode).toBe('append');
    expect(change.messages?.items).toHaveLength(1);
    expect(change.messages?.items[0]?.content).toBe(restrictionMessage);
    expect(change.messages?.items[0]?.additional_kwargs).toEqual(
      expect.objectContaining({
        __requiresFinishTool: true,
      }),
    );
  });

  it('deactivates guard when finish tool is called', async () => {
    const node = new ToolUsageGuardNode({
      getRestrictOutput: () => true,
      getRestrictionMessage: () => 'must call finish tool',
      getRestrictionMaxInjections: () => 3,
    });

    const change = await node.invoke(
      {
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: FinishTool.TOOL_NAME,
                args: { message: 'Done', needsMoreInfo: false },
              },
            ],
          }),
        ],
        summary: '',
        toolsMetadata: {},
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      },
      { configurable: { run_id: 'run-1' } } as never,
    );

    expect(change.toolUsageGuardActivated).toBe(false);
  });

  it('activates guard when other tools are called but not finish', async () => {
    const restrictionMessage = 'must call finish tool';
    const node = new ToolUsageGuardNode({
      getRestrictOutput: () => true,
      getRestrictionMessage: () => restrictionMessage,
      getRestrictionMaxInjections: () => 3,
    });

    const change = await node.invoke(
      {
        messages: [
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'some_other_tool',
                args: { param: 'value' },
              },
            ],
          }),
        ],
        summary: '',
        toolsMetadata: {},
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      },
      { configurable: { run_id: 'run-1' } } as never,
    );

    expect(change.toolUsageGuardActivated).toBe(true);
    expect(change.toolUsageGuardActivatedCount).toBe(1);
    expect(change.messages?.mode).toBe('append');
    expect(change.messages?.items).toHaveLength(1);
    expect(change.messages?.items[0]?.content).toBe(restrictionMessage);
    expect(change.messages?.items[0]?.additional_kwargs).toEqual(
      expect.objectContaining({
        __requiresFinishTool: true,
      }),
    );
  });
});
