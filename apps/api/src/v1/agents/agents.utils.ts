import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';

import { BaseAgentConfigurable } from './services/nodes/base-node';

export function updateMessageWithMetadata(
  message: BaseMessage,
  runnableConfig: RunnableConfig<BaseAgentConfigurable>,
) {
  if (message.additional_kwargs?.run_id) {
    return message;
  }

  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(message)),
    message,
  );

  const prev = clone.additional_kwargs ?? {};
  clone.additional_kwargs = {
    ...prev,
    run_id: runnableConfig?.configurable?.run_id,
  };

  return clone;
}

export function updateMessagesListWithMetadata(
  messages: BaseMessage[],
  runnableConfig: RunnableConfig<BaseAgentConfigurable>,
) {
  return messages.map((msg) => updateMessageWithMetadata(msg, runnableConfig));
}
