import {
  AIMessage,
  AIMessageChunk,
  ChatMessage,
  ContentBlock,
} from '@langchain/core/messages';
import { BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { InvalidToolCall, ToolCall } from '@langchain/core/messages/tool';
import { RunnableConfig } from '@langchain/core/runnables';
import { isPlainObject } from 'lodash';
import type { UnknownRecord } from 'type-fest';

import type { MessageAdditionalKwargs } from './agents.types';
import { BaseAgentConfigurable } from './services/nodes/base-node';

function getMessageKwargs(msg: BaseMessage): MessageAdditionalKwargs {
  const raw = msg.additional_kwargs as unknown;
  return isPlainObject(raw) ? (raw as MessageAdditionalKwargs) : {};
}

export function getMessageRunId(msg: BaseMessage): string | undefined {
  const k = getMessageKwargs(msg);
  const v = k.__runId ?? (k as { run_id?: unknown }).run_id;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function isHiddenForLlm(msg: BaseMessage): boolean {
  const k = getMessageKwargs(msg);
  const v = k.__hideForLlm ?? (k as { hideForLlm?: unknown }).hideForLlm;
  return v === true;
}

function cloneMessage<T extends BaseMessage>(message: T): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(message)) as T,
    message,
  );
}

function sanitizeMessageForLlm<T extends BaseMessage>(message: T): T {
  const clone: BaseMessage = cloneMessage(message);

  delete clone.id;

  if (clone instanceof AIMessage) {
    const flattened = extractTextFromResponseContent(clone.content);
    if (flattened !== undefined) {
      clone.content = flattened;
    }
  }

  return clone as T;
}

export function extractTextFromResponseContent(
  content: unknown,
): string | undefined {
  const flattenBlocks = (blocks: ContentBlock[]): string =>
    blocks
      .filter(
        (block): block is ContentBlock.Text =>
          block?.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text.trim())
      .filter((text) => text.length > 0)
      .join('\n');

  if (Array.isArray(content)) {
    return flattenBlocks(content as ContentBlock[]);
  }

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return flattenBlocks(parsed as ContentBlock[]);
        }
      } catch {
        // ignore parse errors and fall back to trimmed string
      }
    }

    return trimmed;
  }

  return undefined;
}

export function updateMessageWithMetadata(
  message: BaseMessage,
  runnableConfig: RunnableConfig<BaseAgentConfigurable>,
) {
  const currentKwargs = message.additional_kwargs as unknown;
  if (
    isPlainObject(currentKwargs) &&
    typeof getMessageRunId(message) === 'string'
  ) {
    return message;
  }

  const clone = cloneMessage(message);

  // @langchain/openai's completions converter currently assumes response_metadata exists.
  // Ensure we always have an object here (even for system/human/tool messages).
  (clone as unknown as { response_metadata?: unknown }).response_metadata = {};

  const prev = getMessageKwargs(clone);
  const configurable = runnableConfig?.configurable as
    | (BaseAgentConfigurable & {
        __interAgentCommunication?: boolean;
        __sourceAgentNodeId?: string;
      })
    | undefined;

  clone.additional_kwargs = {
    ...prev,
    __runId: runnableConfig?.configurable?.run_id,
    __createdAt:
      (typeof prev.__createdAt === 'string' && prev.__createdAt) ||
      (typeof (prev as { created_at?: unknown }).created_at === 'string' &&
        (prev as { created_at?: string }).created_at) ||
      new Date().toISOString(),
    // Apply inter-agent communication metadata if present in configurable
    ...(configurable?.__interAgentCommunication
      ? {
          __interAgentCommunication: true,
          __sourceAgentNodeId: configurable.__sourceAgentNodeId,
        }
      : {}),
  };

  return clone;
}

export function updateMessagesListWithMetadata(
  messages: BaseMessage[],
  runnableConfig: RunnableConfig<BaseAgentConfigurable>,
) {
  return messages.map((msg) => updateMessageWithMetadata(msg, runnableConfig));
}

export function markMessageHideForLlm<T extends BaseMessage>(message: T): T {
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(message)) as T,
    message,
  );

  const prev = getMessageKwargs(clone);
  clone.additional_kwargs = {
    ...prev,
    __hideForLlm: true,
  };

  return clone;
}

export function filterMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  const visible = messages.filter((msg) => {
    // Defense-in-depth: "reasoning" messages must never be sent back to the LLM,
    // even if they were not explicitly marked with hideForLlm.
    const role = (msg as unknown as { role?: unknown }).role;
    if (role === 'reasoning') {
      return false;
    }

    return !isHiddenForLlm(msg);
  });

  const toolResultIds = new Set(
    visible
      .filter((m) => m instanceof ToolMessage)
      .map((m) => (m as ToolMessage).tool_call_id),
  );

  const getToolCallIdsFromAiMessage = (m: AIMessage): string[] => {
    const ids: string[] = [];

    // LangChain-native (preferred)
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc && typeof tc.id === 'string' && tc.id.length > 0) {
          ids.push(tc.id);
        }
      }
    }

    // OpenAI/LiteLLM transport compatibility: tool_calls can be placed in additional_kwargs
    const kwToolCalls = (m.additional_kwargs as { tool_calls?: unknown })
      ?.tool_calls;
    if (Array.isArray(kwToolCalls)) {
      for (const tc of kwToolCalls) {
        const id = (tc as { id?: unknown })?.id;
        if (typeof id === 'string' && id.length > 0) {
          ids.push(id);
        }
      }
    }

    return Array.from(new Set(ids));
  };

  // First pass: decide which tool-calling AI messages are safe to keep.
  // (All tool calls must have matching tool results present in the same list.)
  const safeAiToolCallIds = new Set<string>();
  const keepAiMessage = new WeakSet<AIMessage>();

  // Defence-in-depth: keep ToolMessage IDs that follow an AI message whose
  // tool_calls have no extractable IDs (e.g. undefined/empty ids from some
  // providers).  Without this, the ToolMessages would be dropped as "dangling"
  // and the LLM would never see tool results, causing an infinite loop.
  const positionalSafeToolResultIds = new Set<string>();

  for (let i = 0; i < visible.length; i++) {
    const m = visible[i];
    if (!(m instanceof AIMessage)) continue;

    const callIds = getToolCallIdsFromAiMessage(m);

    if (callIds.length === 0) {
      keepAiMessage.add(m);

      // If the AI message has tool_calls entries but none had extractable IDs,
      // accept the ToolMessages that immediately follow it positionally.
      const hasToolCallsEntries =
        (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) ||
        (Array.isArray(
          (m.additional_kwargs as { tool_calls?: unknown })?.tool_calls,
        ) &&
          ((m.additional_kwargs as { tool_calls?: unknown[] }).tool_calls!
            .length ?? 0) > 0);

      if (hasToolCallsEntries) {
        for (let j = i + 1; j < visible.length; j++) {
          const next = visible[j];
          if (!(next instanceof ToolMessage)) break;
          positionalSafeToolResultIds.add(next.tool_call_id);
        }
      }

      continue;
    }

    const allAnswered = callIds.every((id) => toolResultIds.has(id));
    if (allAnswered) {
      keepAiMessage.add(m);
      for (const id of callIds) safeAiToolCallIds.add(id);
    }
  }

  // Second pass: filter out dangling tool calls AND dangling tool results.
  // ToolMessages without a matching tool call must not be sent to the model (invalid chat trace).
  return visible.filter((m) => {
    if (m instanceof AIMessage) {
      return keepAiMessage.has(m);
    }
    if (m instanceof ToolMessage) {
      return (
        safeAiToolCallIds.has(m.tool_call_id) ||
        positionalSafeToolResultIds.has(m.tool_call_id)
      );
    }
    return true;
  });
}

/**
 * Prepares messages for sending to the LLM.
 * - Filters out messages explicitly marked as "hideForLlm"
 * - Cleans dangling tool calls so the LLM sees a consistent tool-call trace
 * - Strips provider-specific ids/metadata and flattens structured content
 */
export function prepareMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  return filterMessagesForLlm(messages).map((m) => sanitizeMessageForLlm(m));
}

export function convertChunkToMessage(chunk: AIMessageChunk): AIMessage {
  // Some providers (or older LangChain conversions) may store tool calls under
  // `additional_kwargs.tool_calls` in the OpenAI shape:
  // { id, type: "function", function: { name, arguments: "json" }, index }
  // If we ignore this, tools never execute and the tool-usage-guard loops forever.
  const additionalKwargs = (chunk as unknown as { additional_kwargs?: unknown })
    .additional_kwargs as Record<string, unknown> | undefined;

  const normalizeOpenAiToolCalls = (calls: unknown): ToolCall[] => {
    if (!Array.isArray(calls)) return [];
    return calls
      .map((c) => {
        const obj = c as Record<string, unknown>;
        const fn = obj.function as Record<string, unknown> | undefined;
        const name = fn?.name;
        const argsRaw = fn?.arguments;
        if (typeof name !== 'string') return undefined;

        let args: UnknownRecord = {};
        if (typeof argsRaw === 'string') {
          try {
            const parsed = JSON.parse(argsRaw) as unknown;
            args =
              parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as UnknownRecord)
                : { __raw: parsed };
          } catch {
            args = { __raw: argsRaw };
          }
        } else if (argsRaw !== undefined) {
          args =
            argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
              ? (argsRaw as UnknownRecord)
              : { __raw: argsRaw };
        }

        return {
          id: typeof obj.id === 'string' ? obj.id : undefined,
          name,
          args,
          type: 'tool_call',
        } satisfies ToolCall;
      })
      .filter(Boolean) as ToolCall[];
  };

  const toolCallsFromChunk: ToolCall[] = Array.isArray(chunk.tool_calls)
    ? (chunk.tool_calls as ToolCall[])
    : [];
  const toolCallsFromAdditional = normalizeOpenAiToolCalls(
    additionalKwargs?.tool_calls,
  );
  const toolCalls: ToolCall[] =
    toolCallsFromChunk.length > 0
      ? toolCallsFromChunk
      : toolCallsFromAdditional;

  const invalidToolCalls: InvalidToolCall[] | undefined = Array.isArray(
    chunk.invalid_tool_calls,
  )
    ? (chunk.invalid_tool_calls as InvalidToolCall[])
    : Array.isArray(additionalKwargs?.invalid_tool_calls)
      ? (additionalKwargs?.invalid_tool_calls as InvalidToolCall[])
      : undefined;

  return new AIMessage({
    id: chunk.id,
    name: chunk.name,
    content: chunk.content,
    contentBlocks: chunk.contentBlocks,
    response_metadata: chunk.response_metadata ?? {},
    tool_calls: toolCalls,
    invalid_tool_calls: invalidToolCalls,
    usage_metadata: chunk.usage_metadata,
  });
}

export function buildReasoningMessage(
  content: string,
  parentMessageId?: string,
): ChatMessage {
  const msg = new ChatMessage(content, 'reasoning');
  if (parentMessageId) {
    const reasoningId = `reasoning:${parentMessageId}`;
    msg.id = reasoningId;
    msg.additional_kwargs = {
      ...(msg.additional_kwargs ?? {}),
      __reasoningId: reasoningId,
    };
  }

  return markMessageHideForLlm(msg);
}
