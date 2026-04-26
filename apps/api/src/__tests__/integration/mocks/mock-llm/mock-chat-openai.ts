import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BindToolsInput } from '@langchain/core/language_models/chat_models';
import {
  BaseChatModel,
  type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';

import type { RequestTokenUsage } from '../../../../v1/litellm/litellm.types';
import type { MockLlmService } from './mock-llm.service';
import type { MockLlmRequest } from './mock-llm.types';

// ---------------------------------------------------------------------------
// Content stringification helpers
// ---------------------------------------------------------------------------

function stringifyContent(content: BaseMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  // Array of content blocks — join text parts
  return content
    .map((block) => {
      if (typeof block === 'string') {
        return block;
      }
      if ('text' in block && typeof block.text === 'string') {
        return block.text;
      }
      return JSON.stringify(block);
    })
    .join('');
}

function extractSystem(messages: BaseMessage[]): string | undefined {
  const msg = messages.find(
    (m) => m._getType() === 'system' || m instanceof SystemMessage,
  );
  return msg ? stringifyContent(msg.content) : undefined;
}

function extractLastUser(messages: BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: BaseMessage | undefined = messages[i];
    if (m && (m._getType() === 'human' || m instanceof HumanMessage)) {
      return stringifyContent(m.content);
    }
  }
  return undefined;
}

function extractLastTool(
  messages: BaseMessage[],
): { name: string; content: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m: BaseMessage | undefined = messages[i];
    if (m && (m._getType() === 'tool' || m instanceof ToolMessage)) {
      const toolMsg = m as ToolMessage;
      const name =
        toolMsg.name ??
        (toolMsg as unknown as { tool_call_id?: string }).tool_call_id ??
        'unknown';
      return { name, content: stringifyContent(toolMsg.content) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Usage helpers
// ---------------------------------------------------------------------------

function buildUsageMetadata(usage: Partial<RequestTokenUsage> | undefined): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
} {
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const total = usage?.totalTokens ?? input + output;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

/**
 * Build the `response_metadata.usage` shape consumed by `invoke-llm-node.ts`.
 *
 * `InvokeLlmNode` reads `res.response_metadata?.usage` and looks for a
 * `cost` field (OpenRouter-style provider-reported cost). Setting it here
 * ensures that `LitellmService.extractTokenUsageFromResponse` takes the
 * provider-cost branch and returns `totalPrice` without making any network
 * call to `liteLlmClient.getModelInfo`.
 */
function buildResponseMetadataUsage(
  usage: Partial<RequestTokenUsage> | undefined,
): Record<string, unknown> {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    // LangChain normalised field names (read by extractTokenUsageFromResponse)
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: usage?.totalTokens ?? inputTokens + outputTokens,
    // Provider-cost field consumed by InvokeLlmNode's providerCost branch
    cost: usage?.totalPrice ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Split text into ~4 equal chunks for streaming simulation
// ---------------------------------------------------------------------------

function splitIntoChunks(text: string, count: number): string[] {
  if (text.length === 0) {
    return [''];
  }
  const chunkSize = Math.ceil(text.length / count);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// MockChatOpenAI
// ---------------------------------------------------------------------------

/**
 * LangChain `BaseChatModel` implementation backed by `MockLlmService`.
 *
 * Instances are constructed with a lazy getter for `MockLlmService` so the
 * singleton accessor is only resolved at call time, not at construction time.
 * This decouples `MockChatOpenAI` from the singleton module entirely — the
 * getter is wired up by Step 5's patch installer.
 */
export class MockChatOpenAI extends BaseChatModel {
  private readonly _mockLlmGetter: () => MockLlmService;
  private readonly _model: string;
  private readonly _params: unknown;

  /** Names of tools bound via `bindTools()`. Undefined when no tools are bound. */
  public _boundTools: string[] | undefined;

  constructor(
    mockLlmGetter: () => MockLlmService,
    opts: { model: string; params?: unknown },
    baseParams?: BaseChatModelParams,
  ) {
    super(baseParams ?? {});
    this._mockLlmGetter = mockLlmGetter;
    this._model = opts.model;
    this._params = opts.params;
  }

  _llmType(): string {
    return 'mock-chat-openai';
  }

  /**
   * Return a clone with `_boundTools` set to the names of the provided tools.
   * The clone is a proper `MockChatOpenAI` instance so all `BaseChatModel`
   * and `Runnable` methods are inherited correctly.
   */
  bindTools(
    tools: BindToolsInput[],
    _kwargs?: Partial<this['ParsedCallOptions']>,
  ): MockChatOpenAI {
    const toolNames = tools.map((t) => {
      if ('name' in t && typeof (t as { name?: unknown }).name === 'string') {
        return (t as { name: string }).name;
      }
      if (
        'function' in t &&
        t.function !== null &&
        typeof t.function === 'object' &&
        'name' in t.function &&
        typeof (t.function as { name?: unknown }).name === 'string'
      ) {
        return (t.function as { name: string }).name;
      }
      return 'unknown';
    });

    const cloned = new MockChatOpenAI(this._mockLlmGetter, {
      model: this._model,
      params: this._params,
    });
    cloned._boundTools = toolNames;
    return cloned;
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const mockLlm = this._mockLlmGetter();
    const callIndex = mockLlm.nextCallIndex();

    const request: MockLlmRequest = {
      kind: 'chat',
      model: this._model,
      messages: messages.map((m) => ({
        role: m._getType(),
        content: stringifyContent(m.content),
        name: (m as unknown as { name?: string }).name,
      })),
      systemMessage: extractSystem(messages),
      lastUserMessage: extractLastUser(messages),
      lastToolResult: extractLastTool(messages),
      boundTools: this._boundTools,
      callIndex,
    };

    const reply = mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    if (reply.kind === 'embeddings') {
      throw new Error(
        'MockChatOpenAI received an embeddings reply — register via onChat instead',
      );
    }

    // Defensive: kind === 'json' should not reach the chat model. Convert to text.
    if (reply.kind === 'json') {
      const textContent = JSON.stringify(reply.content);
      const usageMeta = buildUsageMetadata(reply.usage);
      const usageForMetadata = buildResponseMetadataUsage(reply.usage);
      return {
        generations: [
          {
            text: textContent,
            message: new AIMessage({
              content: textContent,
              usage_metadata: usageMeta,
              response_metadata: { usage: usageForMetadata },
            }),
          },
        ],
        llmOutput: { tokenUsage: usageForMetadata },
      };
    }

    if (reply.kind === 'text') {
      const usageMeta = buildUsageMetadata(reply.usage);
      const usageForMetadata = buildResponseMetadataUsage(reply.usage);
      return {
        generations: [
          {
            text: reply.content,
            message: new AIMessage({
              content: reply.content,
              usage_metadata: usageMeta,
              response_metadata: { usage: usageForMetadata },
            }),
          },
        ],
        llmOutput: { tokenUsage: usageForMetadata },
      };
    }

    // kind === 'toolCall'
    const usageMeta = buildUsageMetadata(reply.usage);
    const usageForMetadata = buildResponseMetadataUsage(reply.usage);
    const toolCallId = `call_${crypto.randomUUID()}`;
    return {
      generations: [
        {
          text: '',
          message: new AIMessage({
            content: '',
            tool_calls: [
              {
                id: toolCallId,
                name: reply.toolName,
                args: reply.args,
                type: 'tool_call',
              },
            ],
            usage_metadata: usageMeta,
            response_metadata: { usage: usageForMetadata },
          }),
        },
      ],
      llmOutput: { tokenUsage: usageForMetadata },
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const mockLlm = this._mockLlmGetter();
    const callIndex = mockLlm.nextCallIndex();

    const request: MockLlmRequest = {
      kind: 'chat',
      model: this._model,
      messages: messages.map((m) => ({
        role: m._getType(),
        content: stringifyContent(m.content),
        name: (m as unknown as { name?: string }).name,
      })),
      systemMessage: extractSystem(messages),
      lastUserMessage: extractLastUser(messages),
      lastToolResult: extractLastTool(messages),
      boundTools: this._boundTools,
      callIndex,
    };

    const reply = mockLlm.match(request);

    if (reply.kind === 'error') {
      throw Object.assign(new Error(reply.message), { status: reply.status });
    }

    if (reply.kind === 'embeddings') {
      throw new Error(
        'MockChatOpenAI received an embeddings reply — register via onChat instead',
      );
    }

    const usageMeta = buildUsageMetadata(reply.usage);
    const usageForMetadata = buildResponseMetadataUsage(reply.usage);

    if (reply.kind === 'toolCall') {
      const toolCallId = `call_${crypto.randomUUID()}`;
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          tool_call_chunks: [
            {
              type: 'tool_call_chunk',
              id: toolCallId,
              name: reply.toolName,
              args: JSON.stringify(reply.args),
              index: 0,
            },
          ],
        }),
      });

      // Final chunk with usage
      yield new ChatGenerationChunk({
        text: '',
        message: new AIMessageChunk({
          content: '',
          usage_metadata: usageMeta,
          response_metadata: { usage: usageForMetadata },
        }),
      });
      return;
    }

    // kind === 'text' or kind === 'json' (defensive)
    const textContent =
      reply.kind === 'json' ? JSON.stringify(reply.content) : reply.content;

    const textChunks = splitIntoChunks(textContent, 4);

    for (const chunk of textChunks) {
      await runManager?.handleLLMNewToken(chunk);
      yield new ChatGenerationChunk({
        text: chunk,
        message: new AIMessageChunk({ content: chunk }),
      });
    }

    // Final chunk carrying usage metadata
    yield new ChatGenerationChunk({
      text: '',
      message: new AIMessageChunk({
        content: '',
        usage_metadata: usageMeta,
        response_metadata: { usage: usageForMetadata },
      }),
    });
  }
}
