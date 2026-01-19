import { AIMessage, ToolMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';
import { keyBy } from 'lodash';

import { ToolInvokeResult } from '../../../agent-tools/tools/base-tool';
import type { LitellmService } from '../../../litellm/services/litellm.service';
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
    private readonly litellmService: LitellmService,
    opts?: {
      maxOutputChars?: number;
    },
    private readonly logger?: DefaultLogger,
  ) {
    super();
    this.maxOutputChars = opts?.maxOutputChars ?? 500_000;
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

    const results = await Promise.all(
      calls.map(async (tc) => {
        const callId =
          tc.id ?? `missing_id_${Math.random().toString(36).slice(2)}`;
        const tool = toolsMap[tc.name];
        const makeMsg = (
          content: string,
          messageMetadata?: ToolInvokeResult<unknown>['messageMetadata'],
        ) =>
          new ToolMessage({
            tool_call_id: callId,
            name: tc.name,
            content,
            ...(messageMetadata ? { additional_kwargs: messageMetadata } : {}),
          });

        const makeErrorMsg = (
          content: string,
          messageMetadata?: ToolInvokeResult<unknown>['messageMetadata'],
        ) =>
          new ToolMessage({
            tool_call_id: callId,
            name: tc.name,
            content: JSON.stringify({ error: content }),
            ...(messageMetadata ? { additional_kwargs: messageMetadata } : {}),
          });

        if (!tool) {
          return {
            toolName: tc.name,
            toolMessage: makeErrorMsg(`Tool '${tc.name}' not found.`),
            stateChange: undefined as unknown,
          };
        }

        try {
          const toolMetadata = state.toolsMetadata?.[tc.name];
          const rawResult = (await tool.invoke<
            unknown,
            ToolRunnableConfig<BaseAgentConfigurable>
          >(tc.args, {
            configurable: {
              ...(cfg.configurable ?? {}),
              ...(toolMetadata !== undefined ? { toolMetadata } : {}),
            },
            signal: cfg.signal,
          })) as unknown;
          const { output, messageMetadata, stateChange, toolRequestUsage } =
            rawResult as ToolInvokeResult<unknown>;

          const content =
            typeof output === 'string' ? output : JSON.stringify(output);

          if (content.length > this.maxOutputChars) {
            const trimmed = content.slice(0, this.maxOutputChars);
            const suffix = `\n\n[output trimmed to ${this.maxOutputChars} characters from ${content.length}]`;

            return {
              toolName: tc.name,
              toolMessage: makeMsg(`${trimmed}${suffix}`, messageMetadata),
              stateChange,
              toolRequestUsage,
            };
          }

          return {
            toolName: tc.name,
            toolMessage: makeMsg(content, messageMetadata),
            stateChange,
            toolRequestUsage,
          };
        } catch (e) {
          const err = e as Error;
          const isAbortError = err?.name === 'AbortError';

          if (!isAbortError) {
            this.logger?.error(err, `Error executing tool '${tc.name}'`, {
              toolName: tc.name,
              callId,
            });
          }
          return {
            toolName: tc.name,
            toolMessage: makeErrorMsg(
              `Error executing tool '${tc.name}': ${err?.message || String(err)}`,
            ),
            stateChange: undefined as unknown,
          };
        }
      }),
    );

    const toolMessages = results.map((r) => r.toolMessage);

    // Attach token usage to tool messages that have it
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && result.toolRequestUsage) {
        const msg = toolMessages[i];
        if (msg) {
          msg.additional_kwargs = {
            ...(msg.additional_kwargs ?? {}),
            __requestUsage: result.toolRequestUsage,
          };
        }
      }
    }

    const toolsMetadataUpdate = results.reduce(
      (acc, r) => {
        if (r.stateChange !== undefined) {
          acc[r.toolName] = r.stateChange as Record<string, unknown>;
        }
        return acc;
      },
      {} as Record<string, Record<string, unknown>>,
    );

    const messagesWithMetadata = updateMessagesListWithMetadata(
      toolMessages,
      cfg,
    );

    // Aggregate all tool request usages
    const aggregatedToolUsage = this.litellmService.sumTokenUsages(
      results.map((r) => r.toolRequestUsage).filter(Boolean),
    );

    return {
      messages: {
        mode: 'append',
        items: messagesWithMetadata,
      },
      toolsMetadata: toolsMetadataUpdate,
      // Spread aggregated tool usage into state (will be added by reducers)
      ...(aggregatedToolUsage ?? {}),
    };
  }
}
