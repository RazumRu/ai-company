import {
  AIMessage,
  AIMessageChunk,
  ChatMessage,
  ContentBlock,
} from '@langchain/core/messages';
import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';

import { BaseAgentConfigurable } from './services/nodes/base-node';

function cloneMessage<T extends BaseMessage>(message: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(message)), message);
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
        const parsed = JSON.parse(trimmed);
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
  if (message.additional_kwargs?.run_id) {
    return message;
  }

  const clone = cloneMessage(message);

  const prev = clone.additional_kwargs ?? {};
  clone.additional_kwargs = {
    ...prev,
    run_id: runnableConfig?.configurable?.run_id,
    created_at: prev.created_at || new Date().toISOString(),
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
    Object.create(Object.getPrototypeOf(message)),
    message,
  );

  const prev = clone.additional_kwargs ?? {};
  clone.additional_kwargs = {
    ...prev,
    hideForLlm: true,
  };

  return clone;
}

export function filterMessagesForLlm(messages: BaseMessage[]): BaseMessage[] {
  return messages.filter((msg) => !msg.additional_kwargs?.hideForLlm);
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
