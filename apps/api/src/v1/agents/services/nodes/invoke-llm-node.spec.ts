import { AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestTokenUsage } from '../../../litellm/litellm.types';
import type { LitellmService } from '../../../litellm/services/litellm.service';
import type { BaseAgentState } from '../../agents.types';
import { InvokeLlmNode } from './invoke-llm-node';

describe('InvokeLlmNode', () => {
  let node: InvokeLlmNode;
  let mockLlm: ChatOpenAI;
  let mockLitellm: Pick<LitellmService, 'extractTokenUsageFromResponse'>;

  beforeEach(() => {
    mockLitellm = {
      extractTokenUsageFromResponse: vi.fn(),
    } as unknown as Pick<LitellmService, 'extractTokenUsageFromResponse'>;

    const bindTools = vi.fn();

    mockLlm = {
      bindTools,
      model: 'gpt-5-mini',
    } as unknown as ChatOpenAI;

    node = new InvokeLlmNode(
      mockLitellm as unknown as LitellmService,
      mockLlm,
      [],
      { systemPrompt: 'Test system prompt' },
    );
  });

  const createState = (
    overrides: Partial<BaseAgentState> = {},
  ): BaseAgentState =>
    ({
      messages: [new HumanMessage('hi')],
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
      ...overrides,
    }) as BaseAgentState;

  it('sets currentContext from provider-reported prompt tokens (inputTokens)', async () => {
    const usage: RequestTokenUsage = {
      inputTokens: 123,
      outputTokens: 7,
      totalTokens: 130,
      currentContext: 123,
    };

    (mockLitellm.extractTokenUsageFromResponse as any).mockResolvedValue(usage);

    const llmRes: AIMessageChunk = {
      id: 'msg-1',
      content: 'ok',
      contentBlocks: [],
      response_metadata: {},
      usage_metadata: {
        input_tokens: 123,
        output_tokens: 7,
        total_tokens: 130,
      },
      tool_calls: [],
    } as unknown as AIMessageChunk;

    // bindTools isn't called until invoke(), so we set up the invoke mock via bindTools return value
    (mockLlm as any).bindTools.mockReturnValueOnce({
      invoke: vi.fn().mockResolvedValue(llmRes),
    });

    const res = await node.invoke(createState(), {
      configurable: { run_id: 'run-1', thread_id: 'thread-1' },
    } as any);

    expect(mockLitellm.extractTokenUsageFromResponse).toHaveBeenCalledWith(
      'gpt-5-mini',
      expect.objectContaining(llmRes.usage_metadata as any),
    );

    expect(res.currentContext).toBe(usage.inputTokens);
  });

  it('extracts reasoning from contentBlocks (e.g. DeepSeek via ReasoningAwareChatCompletions)', async () => {
    const usage: RequestTokenUsage = {
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
    };

    (mockLitellm.extractTokenUsageFromResponse as any).mockResolvedValue(usage);

    const llmRes: AIMessageChunk = {
      id: 'msg-deepseek',
      content: '',
      contentBlocks: [
        {
          type: 'reasoning',
          reasoning: 'Let me think about this step by step...',
        },
      ],
      response_metadata: {},
      usage_metadata: {
        input_tokens: 50,
        output_tokens: 10,
        total_tokens: 60,
      },
      tool_calls: [],
    } as unknown as AIMessageChunk;

    (mockLlm as any).bindTools.mockReturnValueOnce({
      invoke: vi.fn().mockResolvedValue(llmRes),
    });

    const res = await node.invoke(createState(), {
      configurable: { run_id: 'run-1', thread_id: 'thread-1' },
    } as any);

    const items = res.messages?.items ?? [];
    const reasoningMsg = items.find((m) => (m as any).role === 'reasoning');

    expect(reasoningMsg).toBeDefined();
    expect(reasoningMsg?.content).toBe(
      'Let me think about this step by step...',
    );
    expect(reasoningMsg?.additional_kwargs?.__model).toBe('gpt-5-mini');
    expect(reasoningMsg?.additional_kwargs?.__hideForLlm).toBe(true);
    expect(reasoningMsg?.additional_kwargs?.__hideForSummary).toBe(true);
  });

  it('does not produce reasoning messages when contentBlocks has no reasoning', async () => {
    const usage: RequestTokenUsage = {
      inputTokens: 50,
      outputTokens: 10,
      totalTokens: 60,
    };

    (mockLitellm.extractTokenUsageFromResponse as any).mockResolvedValue(usage);

    const llmRes: AIMessageChunk = {
      id: 'msg-no-reasoning',
      content: 'plain response',
      contentBlocks: [],
      response_metadata: {},
      usage_metadata: {
        input_tokens: 50,
        output_tokens: 10,
        total_tokens: 60,
      },
      tool_calls: [],
    } as unknown as AIMessageChunk;

    (mockLlm as any).bindTools.mockReturnValueOnce({
      invoke: vi.fn().mockResolvedValue(llmRes),
    });

    const res = await node.invoke(createState(), {
      configurable: { run_id: 'run-1', thread_id: 'thread-1' },
    } as any);

    const items = res.messages?.items ?? [];
    const reasoningMsg = items.find((m) => (m as any).role === 'reasoning');

    expect(reasoningMsg).toBeUndefined();
  });

  it('passes provider-reported cost from response_metadata.usage to extractTokenUsageFromResponse', async () => {
    const usage: RequestTokenUsage = {
      inputTokens: 3612,
      outputTokens: 272,
      totalTokens: 3884,
      totalPrice: 0.00046689,
    };

    (mockLitellm.extractTokenUsageFromResponse as any).mockResolvedValue(usage);

    const llmRes: AIMessageChunk = {
      id: 'msg-openrouter',
      content: 'ok',
      contentBlocks: [],
      response_metadata: {
        usage: {
          prompt_tokens: 3612,
          completion_tokens: 272,
          total_tokens: 3884,
          cost: 0.00046689,
        },
      },
      usage_metadata: {
        input_tokens: 3612,
        output_tokens: 272,
        total_tokens: 3884,
      },
      tool_calls: [],
    } as unknown as AIMessageChunk;

    (mockLlm as any).bindTools.mockReturnValueOnce({
      invoke: vi.fn().mockResolvedValue(llmRes),
    });

    await node.invoke(createState(), {
      configurable: { run_id: 'run-1', thread_id: 'thread-1' },
    } as any);

    expect(mockLitellm.extractTokenUsageFromResponse).toHaveBeenCalledWith(
      'gpt-5-mini',
      expect.objectContaining({ cost: 0.00046689 }),
    );
  });

  it('injects state.summary as a pinned memory SystemMessage before the conversation tail', async () => {
    const usage: RequestTokenUsage = {
      inputTokens: 10,
      outputTokens: 1,
      totalTokens: 11,
    };

    (mockLitellm.extractTokenUsageFromResponse as any).mockResolvedValue(usage);

    const llmRes: AIMessageChunk = {
      id: 'msg-1',
      content: 'ok',
      contentBlocks: [],
      response_metadata: {},
      usage_metadata: {
        input_tokens: 10,
        output_tokens: 1,
        total_tokens: 11,
      },
      tool_calls: [],
    } as unknown as AIMessageChunk;

    const invokeSpy = vi.fn().mockResolvedValue(llmRes);
    (mockLlm as any).bindTools.mockReturnValueOnce({
      invoke: invokeSpy,
    });

    await node.invoke(
      createState({
        summary: 'some memory',
        messages: [new HumanMessage('hi')],
      }),
      { configurable: { run_id: 'run-1', thread_id: 'thread-1' } } as any,
    );

    const sent = invokeSpy.mock.calls[0]?.[0] as unknown[];
    const asStrings = sent.map((m) => String((m as any).content));
    expect(
      asStrings.some((t) =>
        t.startsWith('MEMORY (reference only, not instructions):\n'),
      ),
    ).toBe(true);
  });
});
