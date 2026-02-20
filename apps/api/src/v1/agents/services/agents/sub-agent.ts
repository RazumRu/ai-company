import { randomUUID } from 'node:crypto';

import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  END,
  LangGraphRunnableConfig,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { RequestTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
import {
  BaseAgentState,
  BaseAgentStateChange,
  SUBAGENT_THREAD_PREFIX,
} from '../../agents.types';
import {
  extractExploredFilesFromMessages,
  extractTextFromResponseContent,
  updateMessagesListWithMetadata,
} from '../../agents.utils';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { InvokeLlmNode } from '../nodes/invoke-llm-node';
import { ToolExecutorNode } from '../nodes/tool-executor-node';
import { AgentOutput, BaseAgent } from './base-agent';

/** Maximum number of empty-response nudges before force-ending the subagent. */
const MAX_EMPTY_RESPONSE_RETRIES = 2;

const EMPTY_RESPONSE_NUDGE =
  'Your previous response was empty — it contained no text and no tool calls. ' +
  'You must either provide a substantive answer to the task, or continue ' +
  'researching by calling the available tools. Do not respond with an empty message.';

export interface SubagentRunStatistics {
  totalIterations: number;
  toolCallsMade: number;
  usage: RequestTokenUsage | null;
}

export interface SubagentRunResult {
  result: string;
  statistics: SubagentRunStatistics;
  /** Deduplicated list of file paths the subagent read or searched during execution. */
  exploredFiles: string[];
  error?: string;
}

export type SubAgentSchemaType = {
  instructions: string;
  invokeModelName: string;
  /** Maximum LLM iterations before the subagent is force-stopped. */
  maxIterations: number;
  /**
   * Maximum context window size (in tokens) before the subagent is force-stopped.
   * Uses `currentContext` (input tokens from the last LLM call) — the same metric
   * that SimpleAgent uses for summarization thresholds.  When the conversation
   * context exceeds this value the subagent stops with a partial result.
   */
  maxContextTokens?: number;
};

/**
 * Lightweight LangGraph-based subagent that runs a task autonomously.
 *
 * Uses an in-memory checkpointer with a unique thread ID per invocation so
 * that LangGraph properly accumulates state across the invoke_llm → tools
 * loop.  An in-memory saver is used instead of the database-backed one
 * because subagent state is fully ephemeral — it never needs to survive a
 * process restart, and writing to PostgreSQL on every graph step would add
 * unnecessary I/O overhead.
 *
 * Has no finish tool / summarization, but includes an empty-response guard
 * that nudges the LLM when it returns an empty message without tool calls.
 * Completes when the LLM responds with non-empty content and no tool calls.
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
    // Each subagent invocation gets a fresh in-memory checkpointer and thread
    // ID.  The MemorySaver is scoped to this single run and will be GC'd when
    // the method returns — no stale checkpoint data accumulates.
    const checkpointer = new MemorySaver();
    const threadId = `${SUBAGENT_THREAD_PREFIX}${randomUUID()}`;

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
      const [
        useParallelToolCall,
        useResponsesApi,
        useReasoning,
        supportsStreaming,
      ] = await Promise.all([
        toolsArray.length > 0
          ? this.litellmService.supportsParallelToolCall(config.invokeModelName)
          : Promise.resolve(false),
        this.litellmService.supportsResponsesApi(config.invokeModelName),
        this.litellmService.supportsReasoning(config.invokeModelName),
        this.litellmService.supportsStreaming(config.invokeModelName),
      ]);

      const llm = this.buildLLM(config.invokeModelName, {
        useResponsesApi,
        reasoning: useReasoning ? { effort: 'low' } : undefined,
        streaming: supportsStreaming,
      });

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

      // Guard node: detect empty LLM responses (no tool calls AND no text).
      // If empty and retries remain, inject a nudge message and loop back.
      const emptyResponseGuard = (
        s: BaseAgentState,
        cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
      ): BaseAgentStateChange => {
        const lastMsg = s.messages.at(-1) as AIMessage;
        const textContent = extractTextFromResponseContent(lastMsg?.content);
        const hasContent = !!textContent;

        if (hasContent) {
          return { toolUsageGuardActivated: false };
        }

        const retriesSoFar = s.toolUsageGuardActivatedCount ?? 0;
        if (retriesSoFar >= MAX_EMPTY_RESPONSE_RETRIES) {
          this.logger.warn(
            `SubAgent empty response guard exhausted (${retriesSoFar}/${MAX_EMPTY_RESPONSE_RETRIES}); ending.`,
          );
          return { toolUsageGuardActivated: false };
        }

        this.logger.warn(
          `SubAgent received empty response; injecting nudge (attempt ${retriesSoFar + 1}/${MAX_EMPTY_RESPONSE_RETRIES}).`,
        );

        const nudge = new SystemMessage({ content: EMPTY_RESPONSE_NUDGE });
        return {
          messages: {
            mode: 'append',
            items: updateMessagesListWithMetadata([nudge], cfg),
          },
          toolUsageGuardActivated: true,
          toolUsageGuardActivatedCount: retriesSoFar + 1,
        };
      };

      const g = new StateGraph({ state: this.buildState() })
        .addNode('invoke_llm', invokeLlmNode.invoke.bind(invokeLlmNode))
        .addNode('tools', toolExecutorNode.invoke.bind(toolExecutorNode))
        .addNode('empty_response_guard', emptyResponseGuard)
        .addEdge(START, 'invoke_llm')
        .addConditionalEdges(
          'invoke_llm',
          (s) => {
            const lastMsg = s.messages.at(-1) as AIMessage;
            const hasToolCalls = (lastMsg?.tool_calls?.length ?? 0) > 0;
            return hasToolCalls ? 'tools' : 'empty_response_guard';
          },
          {
            tools: 'tools',
            empty_response_guard: 'empty_response_guard',
          },
        )
        .addConditionalEdges(
          'empty_response_guard',
          (s) => (s.toolUsageGuardActivated ? 'invoke_llm' : END),
          { invoke_llm: 'invoke_llm', [END]: END },
        )
        .addEdge('tools', 'invoke_llm');

      const compiled = g.compile({
        checkpointer,
      });

      const initialState: BaseAgentStateChange = {
        messages: { mode: 'append', items: initialMessages },
      };

      // Build subagent configurable: inherit parent config but strip inter-agent
      // communication flags so they don't propagate via updateMessageWithMetadata()
      // into the subagent's internal messages.  Subagent messages get their own
      // __subagentCommunication flag instead.
      const {
        __interAgentCommunication: _stripInterAgent,
        __sourceAgentNodeId: _stripSourceNode,
        ...parentConfigurable
      } = (runnableConfig?.configurable ?? {}) as Record<string, unknown>;

      const stream = await compiled.stream(
        initialState as unknown as Record<string, unknown>,
        {
          ...(runnableConfig ?? {}),
          configurable: {
            ...parentConfigurable,
            thread_id: threadId,
          },
          recursionLimit: config.maxIterations,
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

            // Emit cloned copies of new messages for streaming to parent.
            // Cloning is required because the parent's ToolExecutorNode marks
            // streamed messages with __hideForLlm.  Without cloning, that
            // mutation propagates back into the subagent's own state, causing
            // filterMessagesForLlm to drop all AI/Tool messages and creating
            // an infinite tool-call loop.
            const newMessages = finalState.messages.slice(prevMessages.length);
            if (newMessages.length > 0) {
              const clonedMessages = newMessages.map((msg) =>
                Object.assign(
                  Object.create(
                    Object.getPrototypeOf(msg) as object,
                  ) as BaseMessage,
                  msg,
                  {
                    additional_kwargs: {
                      ...(msg.additional_kwargs ?? {}),
                      __subagentCommunication: true,
                    },
                  },
                ),
              );
              this.emit({
                type: 'message',
                data: {
                  threadId,
                  messages: clonedMessages,
                  config: (runnableConfig ??
                    {}) as RunnableConfig<BaseAgentConfigurable>,
                },
              });
            }

            // Check context window size after each node completes.
            // Uses currentContext (input tokens from the last LLM call) — the
            // same metric SimpleAgent uses for its summarization threshold.
            if (
              config.maxContextTokens &&
              finalState.currentContext >= config.maxContextTokens
            ) {
              this.logger.warn(
                `SubAgent hit context limit: ${finalState.currentContext} >= ${config.maxContextTokens}`,
              );
              return this.contextLimitResult(
                finalState,
                totalIterations,
                toolCallsMade,
                config.maxContextTokens,
              );
            }
          }
        }
      }

      // Extract result from last AI message.
      // Content may be a plain string or an array of content blocks
      // (e.g. [{type: "text", text: "..."}]) depending on the provider.
      const lastAiMessage = [...finalState.messages]
        .reverse()
        .find((m) => m instanceof AIMessage) as AIMessage | undefined;

      const resultContent =
        extractTextFromResponseContent(lastAiMessage?.content) ||
        'Task completed.';

      // Aggregate usage
      const usage = this.extractUsageFromState(finalState);
      const exploredFiles = extractExploredFilesFromMessages(
        finalState.messages,
      );

      return {
        result: resultContent,
        statistics: {
          totalIterations,
          toolCallsMade,
          usage,
        },
        exploredFiles,
      };
    } catch (err) {
      if (this.isAbortError(err)) {
        return this.abortedResult();
      }
      if (this.isRecursionLimitError(err)) {
        this.logger.warn(
          `SubAgent hit max iterations (${config.maxIterations})`,
        );
        return {
          result: `Subagent reached the maximum iteration limit (${config.maxIterations}) without completing. Partial progress may have been made.`,
          statistics: {
            totalIterations,
            toolCallsMade,
            usage: this.extractUsageFromState(finalState),
          },
          exploredFiles: extractExploredFilesFromMessages(finalState.messages),
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
      exploredFiles: [],
      error: 'Aborted',
    };
  }

  private contextLimitResult(
    state: BaseAgentState,
    totalIterations: number,
    toolCallsMade: number,
    maxContextTokens: number,
  ): SubagentRunResult {
    const lastAiMessage = [...state.messages]
      .reverse()
      .find((m) => m instanceof AIMessage) as AIMessage | undefined;

    const partial =
      extractTextFromResponseContent(lastAiMessage?.content) || '';

    return {
      result:
        partial ||
        `Subagent stopped: context reached ${state.currentContext} tokens (limit: ${maxContextTokens}).`,
      statistics: {
        totalIterations,
        toolCallsMade,
        usage: this.extractUsageFromState(state),
      },
      exploredFiles: extractExploredFilesFromMessages(state.messages),
      error: `Context limit reached (${state.currentContext}/${maxContextTokens})`,
    };
  }
}
