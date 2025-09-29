import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { keyBy } from 'lodash';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { FinishToolResponse } from '../../tools/finish.tool';
import { BaseNode } from './base-node';

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
  ) {
    super();
    this.maxOutputChars = opts?.maxOutputChars ?? 50_000;
  }

  async invoke(
    state: BaseAgentState,
    cfg?: LangGraphRunnableConfig & {
      configurable?: { thread_id?: string; caller_agent?: unknown };
    },
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
          const output = await tool.invoke(tc.args, {
            configurable: {
              thread_id: cfg?.configurable?.thread_id,
              caller_agent: cfg?.configurable?.caller_agent,
            },
          });

          if (output instanceof FinishToolResponse) {
            done = true;
            return makeMsg(output.message || 'Finished');
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
          return makeMsg(
            `Error executing tool '${tc.name}': ${err?.message || String(err)}`,
          );
        }
      }),
    );

    return {
      messages: { mode: 'append', items: toolMessages },
      done: done || state.done,
    };
  }
}
