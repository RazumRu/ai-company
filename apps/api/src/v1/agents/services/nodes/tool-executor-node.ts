import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { DefaultLogger } from '@packages/common';
import { isPlainObject, keyBy } from 'lodash';
import { stringify as stringifyYaml } from 'yaml';

import {
  BuiltAgentTool,
  ToolInvokeResult,
} from '../../../agent-tools/tools/base-tool';
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

        const streamedMessages: BaseMessage[] = [];

        try {
          const toolMetadata = state.toolsMetadata?.[tc.name];
          const builtTool = tool as unknown as BuiltAgentTool;
          const runnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
            configurable: {
              ...(cfg.configurable ?? {}),
              ...(toolMetadata !== undefined ? { toolMetadata } : {}),
            },
            signal: cfg.signal,
          };

          let toolInvokeResult: ToolInvokeResult<unknown>;

          if (builtTool.__streamingInvoke) {
            // Streaming path: call __streamingInvoke directly (bypasses LangChain wrapper)
            const gen = builtTool.__streamingInvoke(
              tc.args,
              runnableConfig,
              toolMetadata,
            );

            const callerAgent = cfg.configurable?.caller_agent;
            const threadId = String(cfg.configurable?.thread_id ?? '');

            let iterResult = await gen.next();
            while (!iterResult.done) {
              const messages = iterResult.value;
              if (messages.length > 0) {
                // Mark messages as:
                // - __streamedRealtime: already emitted in real-time (skip in emitNewMessages)
                // - __hideForLlm: don't include in LLM context (subagent internal messages)
                // - __toolCallId: link to the parent tool call for UI grouping
                for (const msg of messages) {
                  msg.additional_kwargs = {
                    ...(msg.additional_kwargs ?? {}),
                    __streamedRealtime: true,
                    __hideForLlm: true,
                    __toolCallId: callId,
                  };
                }
                streamedMessages.push(...messages);

                // Emit in real-time for WebSocket delivery
                if (callerAgent) {
                  callerAgent.emit({
                    type: 'message',
                    data: {
                      threadId,
                      messages: updateMessagesListWithMetadata(messages, cfg),
                      config: cfg,
                    },
                  });
                }
              }
              iterResult = await gen.next();
            }
            toolInvokeResult = iterResult.value;
          } else {
            // Standard path (unchanged)
            const rawResult = (await tool.invoke<
              unknown,
              ToolRunnableConfig<BaseAgentConfigurable>
            >(tc.args, runnableConfig)) as unknown;
            toolInvokeResult = rawResult as ToolInvokeResult<unknown>;
          }

          const {
            output,
            messageMetadata,
            stateChange,
            toolRequestUsage,
            additionalMessages: toolAdditionalMessages,
          } = toolInvokeResult;

          // Merge streamed messages with any additional messages from the final result
          const additionalMessages = [
            ...streamedMessages,
            ...(toolAdditionalMessages ?? []),
          ];

          const content = this.formatToolOutputForLlm(output);

          if (content.length > this.maxOutputChars) {
            const trimmed = content.slice(0, this.maxOutputChars);
            const suffix = `\n\n[output trimmed to ${this.maxOutputChars} characters from ${content.length}]`;

            return {
              toolName: tc.name,
              toolMessage: makeMsg(`${trimmed}${suffix}`, messageMetadata),
              stateChange,
              toolRequestUsage,
              additionalMessages:
                additionalMessages.length > 0 ? additionalMessages : undefined,
            };
          }

          return {
            toolName: tc.name,
            toolMessage: makeMsg(content, messageMetadata),
            stateChange,
            toolRequestUsage,
            additionalMessages:
              additionalMessages.length > 0 ? additionalMessages : undefined,
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
            // Preserve messages already emitted in real-time before the error
            additionalMessages:
              streamedMessages.length > 0 ? streamedMessages : undefined,
          };
        }
      }),
    );

    // Build interleaved message list: each tool message followed by its additionalMessages
    const interleavedMessages: BaseMessage[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const toolMsg = result?.toolMessage;

      if (!toolMsg) continue;

      // Attach token usage to tool message if present
      if (result.toolRequestUsage) {
        toolMsg.additional_kwargs = {
          ...(toolMsg.additional_kwargs ?? {}),
          __requestUsage: result.toolRequestUsage,
        };
      }

      interleavedMessages.push(toolMsg);

      // Append any additional messages (e.g., from report_status) immediately after the tool result
      if (result.additionalMessages && result.additionalMessages.length > 0) {
        interleavedMessages.push(...result.additionalMessages);
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
      interleavedMessages,
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

  private formatToolOutputForLlm(output: unknown): string {
    if (typeof output === 'string') {
      const trimmed = output.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return output;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!isPlainObject(parsed) && !Array.isArray(parsed)) {
          return output;
        }

        return stringifyYaml(parsed).trimEnd();
      } catch {
        return output;
      }
    }

    if (isPlainObject(output) || Array.isArray(output)) {
      return stringifyYaml(output).trimEnd();
    }

    return JSON.stringify(output);
  }
}
