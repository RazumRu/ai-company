import type { BaseMessage } from '@langchain/core/messages';

import type {
  MessageAdditionalKwargs,
  SerializedBaseMessage,
} from './notifications.types';

/**
 * Convert LangChain BaseMessage instances into JSON-serializable messages
 * suitable for BullMQ payloads.
 */
export function serializeBaseMessages(
  messages: BaseMessage[],
): SerializedBaseMessage[] {
  return messages.map((m) => {
    const type =
      (m as unknown as { constructor?: { name?: string } })?.constructor
        ?.name || 'BaseMessage';

    const obj = m as unknown as Record<string, unknown>;

    const out: SerializedBaseMessage = {
      __serialized: true,
      type,
      content: obj['content'],
      id: typeof obj['id'] === 'string' ? (obj['id'] as string) : undefined,
      role:
        typeof obj['role'] === 'string' ? (obj['role'] as string) : undefined,
      name:
        typeof obj['name'] === 'string' ? (obj['name'] as string) : undefined,
      tool_call_id:
        typeof obj['tool_call_id'] === 'string'
          ? (obj['tool_call_id'] as string)
          : undefined,
      tool_calls: Array.isArray(obj['tool_calls'])
        ? (obj['tool_calls'] as unknown[])
        : undefined,
      invalid_tool_calls: Array.isArray(obj['invalid_tool_calls'])
        ? (obj['invalid_tool_calls'] as unknown[])
        : undefined,
      usage_metadata: obj['usage_metadata'],
      response_metadata: obj['response_metadata'],
      additional_kwargs:
        obj['additional_kwargs'] && typeof obj['additional_kwargs'] === 'object'
          ? (obj['additional_kwargs'] as MessageAdditionalKwargs)
          : undefined,
    };

    return out;
  });
}
