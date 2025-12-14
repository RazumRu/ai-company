import {
  AIMessage,
  AIMessageChunk,
  ChatMessage,
  ContentBlock,
} from '@langchain/core/messages';
import { BaseMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { isPlainObject } from 'lodash';
import type { UnknownRecord } from 'type-fest';

import { BaseAgentConfigurable } from './services/nodes/base-node';

function cloneMessage<T extends BaseMessage>(message: T): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(message)) as T,
    message,
  );
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
    typeof (currentKwargs as UnknownRecord).run_id === 'string'
  ) {
    return message;
  }

  const clone = cloneMessage(message);

  const prev: UnknownRecord = isPlainObject(clone.additional_kwargs as unknown)
    ? (clone.additional_kwargs as UnknownRecord)
    : {};
  clone.additional_kwargs = {
    ...prev,
    run_id: runnableConfig?.configurable?.run_id,
    created_at:
      (typeof prev.created_at === 'string' && prev.created_at) ||
      new Date().toISOString(),
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

  const prev: UnknownRecord = isPlainObject(clone.additional_kwargs as unknown)
    ? (clone.additional_kwargs as UnknownRecord)
    : {};
  clone.additional_kwargs = {
    ...prev,
    hideForLlm: true,
  };

  return clone;
}

export function filterMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter((msg) => !msg.additional_kwargs?.hideForLlm);
}

/**
 * Cleans a message list so tool-calling AI messages are only kept if all their tool calls
 * have matching tool result messages present in the same list.
 *
 * This prevents sending "dangling" tool calls to the LLM (e.g. after trimming context).
 */
export function cleanMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  const toolIds = new Set(
    messages
      .filter((m) => m instanceof ToolMessage)
      .map((m) => (m as ToolMessage).tool_call_id),
  );

  return messages.filter((m) => {
    if (!(m instanceof AIMessage)) {
      return true;
    }

    const toolCalls = m.tool_calls;
    if (!toolCalls?.length) {
      return true;
    }

    return toolCalls.every((tc) => toolIds.has(tc.id ?? ''));
  });
}

/**
 * Prepares messages for sending to the LLM.
 * - Filters out messages explicitly marked as "hideForLlm"
 * - Cleans dangling tool calls so the LLM sees a consistent tool-call trace
 */
export function prepareMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  return cleanMessagesForLlm(filterMessagesForLlm(messages));
}

export function convertChunkToMessage(chunk: AIMessageChunk): AIMessage {
  return new AIMessage({
    id: chunk.id,
    name: chunk.name,
    content: chunk.content,
    contentBlocks: chunk.contentBlocks,
    response_metadata: chunk.response_metadata ?? {},
    tool_calls: chunk.tool_calls ?? [],
    invalid_tool_calls: chunk.invalid_tool_calls,
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
      reasoningId,
    };
  }

  return markMessageHideForLlm(msg);
}
