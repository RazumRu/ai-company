import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it } from 'vitest';

import { MockChatOpenAI } from './mock-chat-openai';
import { MockLlmService } from './mock-llm.service';

describe('MockChatOpenAI', () => {
  let svc: MockLlmService;
  let model: MockChatOpenAI;

  beforeEach(() => {
    svc = new MockLlmService();
    model = new MockChatOpenAI(() => svc, { model: 'gpt-4' });
  });

  it('(a) _generate text reply returns AIMessage with content, usage_metadata, and provider cost', async () => {
    svc.queueChat({
      kind: 'text',
      content: 'hello world',
      usage: {
        inputTokens: 5,
        outputTokens: 3,
        totalTokens: 8,
        totalPrice: 0.42,
      },
    });

    // ParsedCallOptions is complex; {} is sufficient for unit tests
    const result = await model._generate(
      [new HumanMessage('hi')],
      {} as Parameters<typeof model._generate>[1],
    );

    expect(result.generations).toHaveLength(1);
    expect(result.generations[0]?.text).toBe('hello world');

    const msg = result.generations[0]?.message as AIMessage;
    expect(msg.content).toBe('hello world');
    expect(msg.usage_metadata).toMatchObject({
      input_tokens: 5,
      output_tokens: 3,
      total_tokens: 8,
    });

    // The OpenAI-style raw usage on response_metadata must carry the provider
    // cost so that LitellmService.extractTokenUsageFromResponse takes the
    // provider-cost branch (offline-safe — no network call needed).
    const responseMetadata = (
      msg as unknown as {
        response_metadata?: { usage?: { cost?: number } };
      }
    ).response_metadata;
    expect(responseMetadata?.usage?.cost).toBe(0.42);
  });

  it('(b) _generate tool-call reply returns AIMessage with tool_calls', async () => {
    svc.queueChat({
      kind: 'toolCall',
      toolName: 'shell',
      args: { command: 'ls' },
    });

    const result = await model._generate(
      [new HumanMessage('run ls')],
      {} as Parameters<typeof model._generate>[1],
    );

    const msg = result.generations[0]?.message as AIMessage;
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls?.[0]).toMatchObject({
      name: 'shell',
      args: { command: 'ls' },
      type: 'tool_call',
    });
    expect(msg.tool_calls?.[0]?.id).toBeTruthy();
  });

  it('(c) _streamResponseChunks yields >=2 chunks ending with usage_metadata and provider cost', async () => {
    svc.queueChat({
      kind: 'text',
      content: 'this is a longer streamed response',
      usage: {
        inputTokens: 10,
        outputTokens: 7,
        totalTokens: 17,
        totalPrice: 0.91,
      },
    });

    const chunks = [];
    for await (const chunk of model._streamResponseChunks(
      [new HumanMessage('stream')],
      {} as Parameters<typeof model._streamResponseChunks>[1],
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const lastChunk = chunks[chunks.length - 1];
    expect(
      (lastChunk?.message as { usage_metadata?: unknown }).usage_metadata,
    ).toBeDefined();
    expect(
      (lastChunk?.message as { usage_metadata?: { total_tokens?: number } })
        .usage_metadata?.total_tokens,
    ).toBe(17);

    // The final streamed chunk must carry the provider cost on the OpenAI-style
    // response_metadata.usage shape so InvokeLlmNode's providerCost branch fires.
    const lastResponseMetadata = (
      lastChunk?.message as unknown as {
        response_metadata?: { usage?: { cost?: number } };
      }
    ).response_metadata;
    expect(lastResponseMetadata?.usage?.cost).toBe(0.91);

    // Earlier chunks must NOT carry usage_metadata
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(
        (chunks[i]?.message as { usage_metadata?: unknown }).usage_metadata,
      ).toBeUndefined();
    }
  });

  it('(d) bindTools records bound tool names and fixture matching works', async () => {
    const bound = model.bindTools([
      { name: 'shell' } as Parameters<typeof model.bindTools>[0][number],
      { name: 'finish' } as Parameters<typeof model.bindTools>[0][number],
    ]);

    svc.onChat(
      { hasTools: ['shell', 'finish'] },
      { kind: 'text', content: 'bound' },
    );

    const result = await (bound as MockChatOpenAI)._generate(
      [new HumanMessage('test')],
      {} as Parameters<typeof model._generate>[1],
    );

    expect(result.generations[0]?.text).toBe('bound');

    // The bound tools must have been propagated into the request log
    const lastReq = svc.getLastRequest();
    expect(lastReq?.boundTools).toEqual(['shell', 'finish']);
  });

  it('(e) error reply throws with .status', async () => {
    svc.queueChat({ kind: 'error', status: 429, message: 'rate limit' });

    try {
      await model._generate(
        [new HumanMessage('boom')],
        {} as Parameters<typeof model._generate>[1],
      );
      expect.fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toBe('rate limit');
      expect((err as { status?: number }).status).toBe(429);
    }
  });
});
