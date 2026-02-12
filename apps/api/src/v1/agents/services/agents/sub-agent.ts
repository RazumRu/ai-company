import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { END, START, StateGraph } from '@langchain/langgraph';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { RequestTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { InvokeLlmNode } from '../nodes/invoke-llm-node';
import { ToolExecutorNode } from '../nodes/tool-executor-node';
import { AgentOutput, BaseAgent } from './base-agent';

export interface SubagentRunStatistics {
  totalIterations: number;
  toolCallsMade: number;
  usage: RequestTokenUsage | null;
}

export interface SubagentRunResult {
  result: string;
  statistics: SubagentRunStatistics;
  error?: string;
}

export const SUBAGENT_DEFAULT_MAX_ITERATIONS = 25;

export type SubAgentSchemaType = {
  instructions: string;
  invokeModelName: string;
  /** Maximum LLM iterations before the subagent is force-stopped. Default: 25. */
  maxIterations?: number;
};

/**
 * Lightweight LangGraph-based subagent that runs a task autonomously.
 *
 * Unlike SimpleAgent, this is ephemeral (no checkpointer, no persistence),
 * has no finish tool / tool usage guard / summarization / message injection,
 * and completes when the LLM responds without tool calls.
 *
 * Reuses InvokeLlmNode and ToolExecutorNode for consistent LLM invocation
 * and tool execution with the main agent.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class SubAgent extends BaseAgent<SubAgentSchemaType> {
  private currentConfig?: SubAgentSchemaType;

  constructor(
    private readonly litellmService: LitellmService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  /** No-op — SubAgent lifecycle is controlled by the parent's abort signal. */
  public async stop(): Promise<void> {}

  public setConfig(config: SubAgentSchemaType): void {
    this.currentConfig = config;
  }

  public getConfig(): SubAgentSchemaType {
    if (!this.currentConfig) {
      throw new Error('SubAgent config has not been set.');
    }
    return this.currentConfig;
  }

  public async run(
    threadId: string,
    messages: BaseMessage[],
    _config?: SubAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    const { result } = await this.runSubagent(messages, runnableConfig);
    return { messages: [new AIMessage(result)], threadId };
  }

  /**
   * Run the subagent loop and return the typed SubagentRunResult.
   *
   * This is the primary entry point used by SubagentsRunTaskTool.
   * Tools must be set via addTool() and config via setConfig() before calling.
   */
  public async runSubagent(
    messages: BaseMessage[],
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<SubagentRunResult> {
    const abortSignal = runnableConfig?.signal;

    // Early abort check
    if (abortSignal?.aborted) {
      return this.abortedResult();
    }

    const config = this.getConfig();
    const toolsArray = Array.from(this.tools.values());
    const threadId =
      (runnableConfig?.configurable?.thread_id as string) ??
      'subagent-ephemeral';

    const initialMessages = updateMessagesListWithMetadata(
      messages,
      runnableConfig ?? {},
    );

    let totalIterations = 0;
    let toolCallsMade = 0;
    let finalState: BaseAgentState = {
      messages: initialMessages,
      summary: '',
      toolsMetadata: {},
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    };

    try {
      const useParallelToolCall =
        toolsArray.length > 0
          ? await this.litellmService.supportsParallelToolCall(
              config.invokeModelName,
            )
          : false;

      const llm = this.buildLLM(config.invokeModelName);

      const invokeLlmNode = new InvokeLlmNode(
        this.litellmService,
        llm,
        toolsArray,
        {
          systemPrompt: config.instructions,
          toolChoice: toolsArray.length > 0 ? 'auto' : undefined,
          parallelToolCalls: useParallelToolCall,
        },
        this.logger,
      );

      const toolExecutorNode = new ToolExecutorNode(
        toolsArray,
        this.litellmService,
        undefined,
        this.logger,
      );

      const g = new StateGraph({ state: this.buildState() })
        .addNode('invoke_llm', invokeLlmNode.invoke.bind(invokeLlmNode))
        .addNode('tools', toolExecutorNode.invoke.bind(toolExecutorNode))
        .addEdge(START, 'invoke_llm')
        .addConditionalEdges(
          'invoke_llm',
          (s) => {
            const lastMsg = s.messages.at(-1) as AIMessage;
            const hasToolCalls = (lastMsg?.tool_calls?.length ?? 0) > 0;
            return hasToolCalls ? 'tools' : END;
          },
          { tools: 'tools', [END]: END },
        )
        .addEdge('tools', 'invoke_llm');

      const compiled = g.compile();

      const initialState: BaseAgentStateChange = {
        messages: { mode: 'append', items: initialMessages },
      };

      const maxIterations =
        config.maxIterations ?? SUBAGENT_DEFAULT_MAX_ITERATIONS;

      const stream = await compiled.stream(
        initialState as unknown as Record<string, unknown>,
        {
          ...(runnableConfig ?? {}),
          configurable: {
            ...(runnableConfig?.configurable ?? {}),
            thread_id: threadId,
          },
          recursionLimit: maxIterations,
          streamMode: ['updates'],
          signal: abortSignal,
        },
      );

      for await (const event of stream) {
        const [mode, value] = event as ['updates', unknown];

        if (mode === 'updates') {
          const chunk = value as Record<string, BaseAgentStateChange>;

          for (const [nodeName, nodeState] of Object.entries(chunk)) {
            if (!nodeState || typeof nodeState !== 'object') continue;

            const prevMessages = finalState.messages;
            finalState = this.applyChange(finalState, nodeState);

            if (nodeName === 'invoke_llm') {
              totalIterations++;
            }

            if (nodeName === 'tools') {
              const lastMsg = prevMessages.at(-1) as AIMessage | undefined;
              toolCallsMade += lastMsg?.tool_calls?.length ?? 0;
            }

            // Emit new messages for streaming to parent
            const newMessages = finalState.messages.slice(prevMessages.length);
            if (newMessages.length > 0) {
              this.emit({
                type: 'message',
                data: {
                  threadId,
                  messages: newMessages,
                  config: (runnableConfig ??
                    {}) as RunnableConfig<BaseAgentConfigurable>,
                },
              });
            }
          }
        }
      }

      // Extract result from last AI message
      const lastAiMessage = [...finalState.messages]
        .reverse()
        .find((m) => m instanceof AIMessage) as AIMessage | undefined;

      const resultContent =
        typeof lastAiMessage?.content === 'string' && lastAiMessage.content
          ? lastAiMessage.content
          : 'Task completed.';

      // Aggregate usage
      const usage = this.extractUsageFromState(finalState);

      return {
        result: resultContent,
        statistics: {
          totalIterations,
          toolCallsMade,
          usage,
        },
      };
    } catch (err) {
      if (this.isAbortError(err)) {
        return this.abortedResult();
      }
      if (this.isRecursionLimitError(err)) {
        this.logger.warn(
          `SubAgent hit max iterations (${config.maxIterations ?? SUBAGENT_DEFAULT_MAX_ITERATIONS})`,
        );
        return {
          result: `Subagent reached the maximum iteration limit (${config.maxIterations ?? SUBAGENT_DEFAULT_MAX_ITERATIONS}) without completing. Partial progress may have been made.`,
          statistics: {
            totalIterations,
            toolCallsMade,
            usage: this.extractUsageFromState(finalState),
          },
          error: 'Max iterations reached',
        };
      }
      throw err;
    }
  }

  private isAbortError(err: unknown): boolean {
    const name = (err as { name?: string })?.name;
    const msg = (err as { message?: string })?.message ?? '';
    return name === 'AbortError' || msg.toLowerCase().includes('abort');
  }

  private isRecursionLimitError(err: unknown): boolean {
    const name = (err as { name?: string })?.name;
    return name === 'GraphRecursionError';
  }

  private abortedResult(): SubagentRunResult {
    return {
      result: 'Subagent was aborted.',
      statistics: { totalIterations: 0, toolCallsMade: 0, usage: null },
      error: 'Aborted',
    };
  }
}
