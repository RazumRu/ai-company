import { AIMessage, ToolMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';
import { keyBy } from 'lodash';

import { FinishToolResponse } from '../../../agent-tools/tools/finish.tool';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
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

    this.logger?.debug('tool-executor.invoke', {
      toolCalls: calls.map((call) => call.name),
      messageCount: state.messages.length,
    });

    if (!calls.length) {
      this.logger?.debug('tool-executor.no-calls');
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
          this.logger?.warn('tool-executor.tool-not-found', {
            toolName: tc.name,
            callId,
          });
          return makeMsg(`Tool '${tc.name}' not found.`);
        }

        try {
          this.logger?.debug('tool-executor.tool-start', {
            toolName: tc.name,
            callId,
          });
          const output = await tool.invoke<
            unknown,
            ToolRunnableConfig<BaseAgentConfigurable>
          >(tc.args, {
            configurable: cfg.configurable,
          });

          if (output instanceof FinishToolResponse) {
            done = true;
            this.logger?.debug('tool-executor.finish-called', {
              toolName: tc.name,
              callId,
            });
            return makeMsg(output.message || 'Finished');
          }

          const content =
            typeof output === 'string' ? output : JSON.stringify(output);

          if (content.length > this.maxOutputChars) {
            this.logger?.warn('tool-executor.output-too-long', {
              toolName: tc.name,
              callId,
              length: content.length,
            });
            return makeMsg(
              `Error (output too long: ${content.length} characters).`,
            );
          }

          this.logger?.debug('tool-executor.tool-success', {
            toolName: tc.name,
            callId,
          });
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

    this.logger?.debug('tool-executor.invoke.complete', {
      done,
      toolCallCount: calls.length,
    });

    return {
      messages: { mode: 'append', items: toolMessages },
      done: done || state.done,
    };
  }
}
