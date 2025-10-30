import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { BaseAgentConfigurable, BaseNode } from './base-node';

export class TitleGenerationNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(
    private llm: ChatOpenAI,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(
    state: BaseAgentState,
    _cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    // Only generate title if it doesn't exist and there are human messages
    if (state.generatedTitle) {
      return {};
    }

    // Find the first human message to generate title from
    const firstHumanMessage = state.messages.find(
      (msg) => msg instanceof HumanMessage,
    ) as HumanMessage | undefined;

    if (!firstHumanMessage) {
      // No human messages yet, skip title generation
      return {};
    }

    // Extract content from the first human message
    const userInput =
      typeof firstHumanMessage.content === 'string'
        ? firstHumanMessage.content
        : JSON.stringify(firstHumanMessage.content);

    // Generate a concise title (max 100 characters)
    const systemMessage = new SystemMessage(
      'You are a helpful assistant that generates concise, descriptive titles for conversations. ' +
        'Generate a short title (maximum 100 characters) that summarizes the main topic or question. ' +
        'Respond with ONLY the title, no additional text or explanation.',
    );

    const humanMessage = new HumanMessage(
      `Generate a concise title for this conversation based on the first user message:\n\n${userInput}`,
    );

    try {
      const res = (await this.llm.invoke([
        systemMessage,
        humanMessage,
      ])) as AIMessage;

      const generatedTitle =
        typeof res.content === 'string'
          ? res.content.trim().slice(0, 100)
          : JSON.stringify(res.content).trim().slice(0, 100);

      if (generatedTitle) {
        return {
          generatedTitle,
        };
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger?.error(
        errorObj,
        `title-generation-node.error: ${errorObj.message}`,
      );
      // Don't fail the whole graph if title generation fails
    }

    return {};
  }
}
