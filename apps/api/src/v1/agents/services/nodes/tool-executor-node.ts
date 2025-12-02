import { AIMessage, ToolMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';
import { keyBy } from 'lodash';

import { FinishToolResponse } from '../../../agent-tools/tools/core/finish.tool';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { BaseAgentConfigurable, BaseNode } from './base-node';

export class ToolExecutorNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  private maxOutputChars: number;

  constructor(
    private tools: DynamicStructuredTool[],
    opts?: {
      maxOutputChars?: number;
    },
    private readonly logger?: DefaultLogger,
  ) {
    super();
    this.maxOutputChars = opts?.maxOutputChars ?? 50_000;
  }

  async invoke(
    state: BaseAgentState,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    const last = state.messages[state.messages.length - 1];
    const ai = last instanceof AIMessage ? last : undefined;
    const calls = ai?.tool_calls || [];

    if (!calls.length) {
      return {
        messages: { mode: 'append', items: [] },
      };
    }

    const toolsMap = keyBy(this.tools, 'name');
    let done = false;
    let needsMoreInfo = false;

    const toolMessages: ToolMessage[] = await Promise.all(
      calls.map(async (tc) => {
        const callId =
          tc.id ?? `missing_id_${Math.random().toString(36).slice(2)}`;
        const tool = toolsMap[tc.name];
        const makeMsg = (content: string) =>
          new ToolMessage({ tool_call_id: callId, name: tc.name, content });

        if (!tool) {
          return makeMsg(`Tool '${tc.name}' not found.`);
        }

        try {
          const output = await tool.invoke<
            unknown,
            ToolRunnableConfig<BaseAgentConfigurable>
          >(tc.args, {
            configurable: cfg.configurable,
          });

          if (output instanceof FinishToolResponse) {
            // Only set done=true if needsMoreInfo is false
            // If needsMoreInfo is true, the agent needs user input and should stop
            if (!output.needsMoreInfo) {
              done = true;
            } else {
              // Set needsMoreInfo flag in state to stop execution
              needsMoreInfo = true;
            }

            // Include needsMoreInfo flag in the tool message content
            const toolResponse = {
              message: output.message || 'Finished',
              needsMoreInfo: output.needsMoreInfo,
            };

            return makeMsg(JSON.stringify(toolResponse));
          }

          const content =
            typeof output === 'string' ? output : JSON.stringify(output);

          if (content.length > this.maxOutputChars) {
            return makeMsg(
              `Error (output too long: ${content.length} characters).`,
            );
          }

          return makeMsg(content);
        } catch (e) {
          const err = e as Error;
          this.logger?.error(err, `Error executing tool '${tc.name}'`, {
            toolName: tc.name,
            callId,
          });
          return makeMsg(
            `Error executing tool '${tc.name}': ${err?.message || String(err)}`,
          );
        }
      }),
    );

    return {
      messages: {
        mode: 'append',
        items: updateMessagesListWithMetadata(toolMessages, cfg),
      },
      // Only set done if it was explicitly set by finish tool
      // If needsMoreInfo=true, done stays false and we don't set it
      ...(done ? { done: true } : {}),
      ...(needsMoreInfo ? { needsMoreInfo: true } : {}),
    };
  }
}
