import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  ChatMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
  Annotation,
  BaseChannel,
  CompiledStateGraph,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { v4 } from 'uuid';
import { z } from 'zod';

import { BaseMcp } from '../../../agent-mcp/services/base-mcp';
import { FinishTool } from '../../../agent-tools/tools/core/finish.tool';
import { ReportStatusTool } from '../../../agent-tools/tools/core/report-status.tool';
import { GraphExecutionMetadata } from '../../../graphs/graphs.types';
import type { RequestTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../litellm/services/llm-models.service';
import {
  BaseAgentState,
  BaseAgentStateChange,
  BaseAgentStateMessagesUpdateValue,
  NewMessageMode,
  ReasoningEffort,
} from '../../agents.types';
import {
  buildReasoningMessage,
  markMessageHideForLlm,
  updateMessagesListWithMetadata,
} from '../../agents.utils';
import { GraphThreadState } from '../graph-thread-state';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { InjectPendingNode } from '../nodes/inject-pending-node';
import { InvokeLlmNode } from '../nodes/invoke-llm-node';
import { SummarizeNode } from '../nodes/summarize-node';
import { ToolExecutorNode } from '../nodes/tool-executor-node';
import { ToolUsageGuardNode } from '../nodes/tool-usage-guard-node';
import { PgCheckpointSaver } from '../pg-checkpoint-saver';
import { AgentOutput, AgentRunEvent, BaseAgent } from './base-agent';

export const SimpleAgentSchema = z.object({
  name: z.string().min(1).describe('Unique name for this agent'),
  description: z
    .string()
    .min(1)
    .describe('Description of what this agent does')
    .meta({ 'x-ui:textarea': true }),
  summarizeMaxTokens: z
    .number()
    .optional()
    .default(272000)
    .describe(
      'Total token budget for summary + recent context. If current history exceeds this, older messages are folded into the rolling summary.',
    ),
  summarizeKeepTokens: z
    .number()
    .optional()
    .default(30000)
    .describe(
      'Token budget reserved for the most recent messages kept verbatim when summarizing (the "tail").',
    ),
  instructions: z
    .string()
    .describe(
      'System prompt injected at the start of each turn: role, goals, constraints, style.',
    )
    .meta({ 'x-ui:textarea': true })
    .meta({ 'x-ui:ai-suggestions': true }),
  invokeModelName: z
    .string()
    .describe('Chat model used for the main reasoning/tool-call step.')
    .meta({ 'x-ui:show-on-node': true })
    .meta({ 'x-ui:label': 'Model' })
    .meta({ 'x-ui:litellm-models-list-select': true }),
  invokeModelReasoningEffort: z
    .enum(ReasoningEffort)
    .optional()
    .default(ReasoningEffort.None)
    .describe('Reasoning effort')
    .meta({ 'x-ui:show-on-node': true })
    .meta({ 'x-ui:label': 'Reasoning' }),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(2500)
    .default(2500)
    .optional()
    .describe(
      'Maximum number of iterations the agent can execute during a single run.',
    ),
  newMessageMode: z
    .enum(NewMessageMode)
    .default(NewMessageMode.InjectAfterToolCall)
    .optional()
    .describe(
      'Controls how to handle new messages when the agent thread is already running. Inject after tool call adds the new input immediately after the next tool execution completes; wait for completion queues the message until the current run finishes.',
    ),
});

export type SimpleAgentSchemaType = z.infer<typeof SimpleAgentSchema>;

type ActiveRunEntry = {
  abortController: AbortController;
  runnableConfig: RunnableConfig<BaseAgentConfigurable>;
  threadId: string;
  lastState: BaseAgentState;
  stopped?: boolean;
  stopReason?: string;
};

@Injectable({ scope: Scope.TRANSIENT })
export class SimpleAgent extends BaseAgent<SimpleAgentSchemaType> {
  private graph?: CompiledStateGraph<BaseAgentState, Record<string, unknown>>;
  private graphThreadState?: GraphThreadState;
  private graphThreadStateUnsubscribe?: () => void;
  private currentConfig?: SimpleAgentSchemaType;
  private activeRuns = new Map<string, ActiveRunEntry>();
  private mcpServices: BaseMcp[] = [];

  constructor(
    private readonly checkpointer: PgCheckpointSaver,
    private readonly litellmService: LitellmService,
    private readonly logger: DefaultLogger,
    private readonly llmModelsService: LlmModelsService,
  ) {
    super();
  }

  private getActiveRunByThread(threadId: string) {
    for (const run of this.activeRuns.values()) {
      if (run.threadId === threadId) {
        return run;
      }
    }
    return undefined;
  }

  public get schema() {
    return SimpleAgentSchema;
  }

  protected buildState() {
    return Annotation.Root({
      messages: Annotation<BaseMessage[], BaseAgentStateMessagesUpdateValue>({
        reducer: (left, right) =>
          !right
            ? left
            : right.mode === 'append'
              ? [...left, ...right.items]
              : right.items,
        default: () => [],
      }),
      summary: Annotation<string, string>({
        reducer: (left, right) => (right !== undefined ? right : left),
        default: () => '',
      }),
      toolsMetadata: Annotation<
        Record<string, Record<string, unknown>>,
        Record<string, Record<string, unknown>>
      >({
        reducer: (left, right) => (right ? { ...left, ...right } : left),
        default: () => ({}),
      }),
      toolUsageGuardActivatedCount: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
      toolUsageGuardActivated: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
      // Token usage counters (accumulated) - persisted via checkpoints
      inputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      cachedInputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      outputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      reasoningTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      totalTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      totalPrice: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      // Current context size (snapshot) - persisted via checkpoints
      currentContext: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
    } satisfies Record<
      keyof BaseAgentState,
      BaseChannel | (() => BaseChannel)
    >);
  }

  public async initTools(_config: SimpleAgentSchemaType) {
    // ----- finish tool -----
    this.addTool(new FinishTool().build({}));
    this.addTool(new ReportStatusTool().build({}));

    // ----- mcp -----
    for (const mcpService of this.mcpServices) {
      try {
        const mcpTools = await mcpService.discoverTools();

        for (const builtAgentTool of mcpTools) {
          this.addTool(builtAgentTool);
        }
      } catch (error) {
        this.logger.error(
          error instanceof Error ? error : new Error(String(error)),
          `Failed to discover tools from MCP service`,
        );
      }
    }
  }

  protected async buildGraph(config: SimpleAgentSchemaType) {
    if (!this.graph) {
      const graphThreadState = new GraphThreadState();
      this.graphThreadStateUnsubscribe?.();
      this.graphThreadStateUnsubscribe = graphThreadState.subscribe(
        this.handleThreadStateChange,
      );
      await this.initTools(config);

      // ---- summarize ----
      const summarizeNode = new SummarizeNode(
        this.litellmService,
        this.buildLLM(this.llmModelsService.getSummarizeModel()),
        {
          maxTokens: config.summarizeMaxTokens,
          keepTokens: config.summarizeKeepTokens,
          tokenCountModel: config.invokeModelName,
        },
        this.logger,
      );

      // ---- invoke ----
      const toolsArray = this.getTools();
      const useResponsesApi = await this.litellmService.supportsResponsesApi(
        config.invokeModelName,
      );
      const useReasoning = await this.litellmService.supportsReasoning(
        config.invokeModelName,
      );
      const useParallelToolCall =
        await this.litellmService.supportsParallelToolCall(
          config.invokeModelName,
        );

      const invokeLlmNode = new InvokeLlmNode(
        this.litellmService,
        this.buildLLM(config.invokeModelName, {
          useResponsesApi,
          reasoning: useReasoning
            ? {
                effort: config.invokeModelReasoningEffort,
              }
            : undefined,
        }),
        toolsArray,
        {
          systemPrompt: config.instructions,
          toolChoice: 'auto',
          parallelToolCalls: useParallelToolCall,
        },
        this.logger,
      );

      // ---- tool executor ----
      const toolExecutorNode = new ToolExecutorNode(
        toolsArray,
        this.litellmService,
        undefined,
        this.logger,
      );

      // ---- message injection ----
      const injectPendingNode = new InjectPendingNode(
        graphThreadState,
        this.logger,
      );

      // ---- build ----
      const g = new StateGraph({
        stateSchema: this.buildState(),
      })
        .addNode('summarize', summarizeNode.invoke.bind(summarizeNode))
        .addNode('invoke_llm', invokeLlmNode.invoke.bind(invokeLlmNode))
        .addNode('tools', toolExecutorNode.invoke.bind(toolExecutorNode))
        .addNode(
          'inject_pending',
          injectPendingNode.invoke.bind(injectPendingNode),
        )
        // ---- routing ----
        .addEdge(START, 'summarize')
        .addEdge('summarize', 'invoke_llm');

      // ---- tool usage guard (always on) ----
      const toolUsageGuardNode = new ToolUsageGuardNode(
        {
          getRestrictOutput: () => true,
          getRestrictionMessage: () =>
            "You must call the 'finish' tool to end your response. If you have completed the task or have a final answer, call the 'finish' tool with needsMoreInfo=false. If you need more information from the user, call the 'finish' tool with needsMoreInfo=true and include your question in the message.",
          getRestrictionMaxInjections: () => 3,
        },
        this.logger,
      );

      g.addNode(
        'tool_usage_guard',
        toolUsageGuardNode.invoke.bind(toolUsageGuardNode),
      )
        .addConditionalEdges(
          'invoke_llm',
          (s) => {
            const lastMsg = s.messages.at(-1) as AIMessage;
            const hasAnyToolCall = (lastMsg?.tool_calls?.length ?? 0) > 0;
            // If ANY tool was called, execute them. Otherwise check with guard.
            return hasAnyToolCall ? 'tools' : 'tool_usage_guard';
          },
          { tools: 'tools', tool_usage_guard: 'tool_usage_guard' },
        )
        .addConditionalEdges(
          'tool_usage_guard',
          (s) => (s.toolUsageGuardActivated ? 'invoke_llm' : END),
          { invoke_llm: 'invoke_llm', [END]: END },
        )
        .addConditionalEdges(
          'tools',
          (s, cfg) => {
            const threadId = String(cfg.configurable?.thread_id ?? '');
            const { pendingMessages, newMessageMode } =
              graphThreadState.getByThread(threadId);

            const hasPending = pendingMessages.length > 0;
            const mode = newMessageMode ?? NewMessageMode.InjectAfterToolCall;
            const finishState = FinishTool.getStateFromToolsMetadata(
              s.toolsMetadata,
            );
            const isComplete = Boolean(
              finishState && (finishState.done || finishState.needsMoreInfo),
            );

            if (!isComplete) {
              if (mode === NewMessageMode.InjectAfterToolCall && hasPending) {
                return 'inject_pending';
              }
              // Allow agent to continue working - route back to summarize
              return 'summarize';
            }

            if (hasPending) {
              return 'inject_pending';
            }

            return END;
          },
          {
            inject_pending: 'inject_pending',
            summarize: 'summarize',
            [END]: END,
          },
        )
        .addEdge('inject_pending', 'summarize');

      this.graph = g.compile({
        checkpointer: this.checkpointer,
      }) as CompiledStateGraph<BaseAgentState, Record<string, unknown>>;
      this.graphThreadState = graphThreadState;
    }

    return this.graph;
  }

  private applyChange(
    prev: BaseAgentState,
    change: BaseAgentStateChange,
  ): BaseAgentState {
    const nextMessages = change.messages
      ? change.messages.mode === 'append'
        ? [...prev.messages, ...change.messages.items]
        : change.messages.items
      : prev.messages;

    return {
      messages: nextMessages,
      summary: change.summary ?? prev.summary,
      toolsMetadata: change.toolsMetadata
        ? { ...prev.toolsMetadata, ...change.toolsMetadata }
        : prev.toolsMetadata,
      toolUsageGuardActivated:
        change.toolUsageGuardActivated ?? prev.toolUsageGuardActivated,
      toolUsageGuardActivatedCount:
        change.toolUsageGuardActivatedCount ??
        prev.toolUsageGuardActivatedCount,
      inputTokens: prev.inputTokens + (change.inputTokens ?? 0),
      cachedInputTokens:
        prev.cachedInputTokens + (change.cachedInputTokens ?? 0),
      outputTokens: prev.outputTokens + (change.outputTokens ?? 0),
      reasoningTokens: prev.reasoningTokens + (change.reasoningTokens ?? 0),
      totalTokens: prev.totalTokens + (change.totalTokens ?? 0),
      totalPrice: prev.totalPrice + (change.totalPrice ?? 0),
      currentContext: change.currentContext ?? prev.currentContext,
    };
  }

  private async emitNewMessages(
    messages: BaseMessage[],
    rc: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    if (!rc?.configurable?.graph_id) return;
    const runId = rc.configurable.run_id;

    const fresh = messages.filter((m) => {
      const kw = m.additional_kwargs as unknown as Record<string, unknown>;
      return kw.__runId === runId || kw.run_id === runId;
    });

    if (fresh.length > 0) {
      const model = this.currentConfig?.invokeModelName;
      if (typeof model === 'string' && model.length > 0) {
        for (const m of fresh) {
          m.additional_kwargs = {
            ...(m.additional_kwargs ?? {}),
            __model: model,
          };
        }
      }
      this.emit({
        type: 'message',
        data: {
          threadId,
          messages: fresh,
          config: rc,
        },
      });
    }
  }

  /**
   * Compute newly introduced messages for a replace-mode update.
   *
   * Replace-mode updates are used for history compaction (e.g. summarization) and may
   * shorten the message list. In that case, naive `slice(beforeLen)` deltas miss new
   * messages inserted during replacement.
   *
   * We treat messages as identical by object identity, which is stable for messages
   * already present in the state. Nodes should avoid cloning existing messages when
   * they only want to keep them.
   */
  private diffNewMessages(
    prev: BaseMessage[],
    next: BaseMessage[],
  ): BaseMessage[] {
    if (!next.length) return [];
    if (!prev.length) return next;

    const prevSet = new Set(prev);
    return next.filter((m) => !prevSet.has(m));
  }

  public getThreadTokenUsage(threadId: string): RequestTokenUsage | null {
    if (!this.graphThreadState) {
      return null;
    }

    const s = this.graphThreadState.getByThread(threadId);
    const hasAny =
      s.inputTokens !== 0 ||
      s.cachedInputTokens !== 0 ||
      s.outputTokens !== 0 ||
      s.reasoningTokens !== 0 ||
      s.totalTokens !== 0 ||
      s.totalPrice !== 0 ||
      s.currentContext !== 0;

    if (!hasAny) {
      return null;
    }

    return {
      inputTokens: s.inputTokens,
      ...(s.cachedInputTokens
        ? { cachedInputTokens: s.cachedInputTokens }
        : {}),
      outputTokens: s.outputTokens,
      ...(s.reasoningTokens ? { reasoningTokens: s.reasoningTokens } : {}),
      totalTokens: s.totalTokens,
      ...(s.totalPrice ? { totalPrice: s.totalPrice } : {}),
      ...(s.currentContext ? { currentContext: s.currentContext } : {}),
    };
  }

  private syncThreadTotals(threadId: string, state: BaseAgentState) {
    if (!this.graphThreadState) return;
    const prev = this.graphThreadState.getByThread(threadId);
    if (
      prev.inputTokens === state.inputTokens &&
      prev.cachedInputTokens === state.cachedInputTokens &&
      prev.outputTokens === state.outputTokens &&
      prev.reasoningTokens === state.reasoningTokens &&
      prev.totalTokens === state.totalTokens &&
      prev.totalPrice === state.totalPrice &&
      prev.currentContext === state.currentContext
    ) {
      return;
    }
    this.graphThreadState.applyForThread(threadId, {
      inputTokens: state.inputTokens,
      cachedInputTokens: state.cachedInputTokens,
      outputTokens: state.outputTokens,
      reasoningTokens: state.reasoningTokens,
      totalTokens: state.totalTokens,
      totalPrice: state.totalPrice,
      currentContext: state.currentContext,
    });
  }

  private async emitStateUpdate(
    prevState: BaseAgentState,
    nextState: BaseAgentState,
    runnableConfig: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    if (!runnableConfig?.configurable?.graph_id) return;

    // Build state change object with only changed fields
    const stateChange: Partial<BaseAgentState> = {};

    if (prevState.toolsMetadata !== nextState.toolsMetadata) {
      stateChange.toolsMetadata = nextState.toolsMetadata;
    }

    if (
      prevState.toolUsageGuardActivated !== nextState.toolUsageGuardActivated
    ) {
      stateChange.toolUsageGuardActivated = nextState.toolUsageGuardActivated;
    }

    if (
      prevState.toolUsageGuardActivatedCount !==
      nextState.toolUsageGuardActivatedCount
    ) {
      stateChange.toolUsageGuardActivatedCount =
        nextState.toolUsageGuardActivatedCount;
    }

    // Track token usage changes
    if (prevState.inputTokens !== nextState.inputTokens) {
      stateChange.inputTokens = nextState.inputTokens;
    }

    if (prevState.cachedInputTokens !== nextState.cachedInputTokens) {
      stateChange.cachedInputTokens = nextState.cachedInputTokens;
    }

    if (prevState.outputTokens !== nextState.outputTokens) {
      stateChange.outputTokens = nextState.outputTokens;
    }

    if (prevState.reasoningTokens !== nextState.reasoningTokens) {
      stateChange.reasoningTokens = nextState.reasoningTokens;
    }

    if (prevState.totalTokens !== nextState.totalTokens) {
      stateChange.totalTokens = nextState.totalTokens;
    }

    if (prevState.totalPrice !== nextState.totalPrice) {
      stateChange.totalPrice = nextState.totalPrice;
    }

    if (prevState.currentContext !== nextState.currentContext) {
      stateChange.currentContext = nextState.currentContext;
    }

    // Only emit if there are changes
    if (Object.keys(stateChange).length === 0) return;

    // Always include a full token/cost snapshot in every AgentStateUpdate emission.
    // Consumers should be able to treat this event as "current truth" and not have to
    // merge partial diffs while defaulting missing fields to zero.
    stateChange.inputTokens = nextState.inputTokens;
    stateChange.cachedInputTokens = nextState.cachedInputTokens;
    stateChange.outputTokens = nextState.outputTokens;
    stateChange.reasoningTokens = nextState.reasoningTokens;
    stateChange.totalTokens = nextState.totalTokens;
    stateChange.totalPrice = nextState.totalPrice;
    stateChange.currentContext = nextState.currentContext;

    this.emit({
      type: 'stateUpdate',
      data: {
        threadId,
        stateChange,
        config: runnableConfig,
      },
    });
  }

  private async appendMessages(
    messages: BaseMessage[],
    activeRun: ActiveRunEntry,
  ): Promise<void> {
    if (!messages.length) return;
    const threadId = activeRun.threadId;

    const updatedMessages = updateMessagesListWithMetadata(
      messages,
      activeRun.runnableConfig,
    );

    if (this.graphThreadState) {
      this.graphThreadState.applyForThread(threadId, {
        pendingMessages: [
          ...this.graphThreadState.getByThread(threadId).pendingMessages,
          ...updatedMessages,
        ],
      });
    }
  }

  private emitNodeAdditionalMetadataUpdate(meta: GraphExecutionMetadata) {
    if (!meta.threadId) {
      return;
    }

    const additionalMetadata = this.getGraphNodeMetadata(meta);
    this.emit({
      type: 'nodeAdditionalMetadataUpdate',
      data: {
        metadata: meta,
        additionalMetadata,
      },
    });
  }

  private handleReasoningChunk(threadId: string, messageChunk: AIMessageChunk) {
    if (!this.graphThreadState) {
      return;
    }

    const reasoningText = this.extractReasoningFromChunk(messageChunk);
    const reasoningId = messageChunk.id
      ? `reasoning:${messageChunk.id}`
      : undefined;

    if (!reasoningText || !reasoningId) {
      return;
    }

    const { reasoningChunks: prevReasoningChunks } =
      this.graphThreadState.getByThread(threadId);

    // IMPORTANT:
    // Some providers emit reasoning chunks with different `chunk.id` values even though they
    // eventually get persisted as a single reasoning message. To avoid accumulating multiple
    // "reasoning:*" entries in socket metadata, we keep reasoningChunks at max size 1 and
    // migrate accumulated content when the id changes.
    const combinedPreviousContent = Array.from(prevReasoningChunks.values())
      .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
      .join('');

    const currentEntry = prevReasoningChunks.get(reasoningId);
    const currentContent =
      typeof currentEntry?.content === 'string' ? currentEntry.content : '';

    const nextContent =
      (currentEntry ? currentContent : combinedPreviousContent) + reasoningText;

    const nextReasoningChunks = new Map<string, ChatMessage>();
    nextReasoningChunks.set(
      reasoningId,
      buildReasoningMessage(nextContent, messageChunk.id),
    );

    this.graphThreadState.applyForThread(threadId, {
      reasoningChunks: nextReasoningChunks,
    });
  }

  private clearReasoningState(threadId: string) {
    if (!this.graphThreadState) {
      return;
    }

    const { reasoningChunks } = this.graphThreadState.getByThread(threadId);

    if (!reasoningChunks.size) {
      return;
    }

    this.graphThreadState.applyForThread(threadId, {
      reasoningChunks: new Map(),
    });
  }

  private formatStoppedReason(reason?: string): string {
    const base = reason ?? 'Graph execution was stopped';
    if (base !== 'Graph execution was stopped') {
      return base;
    }

    const agentName = this.currentConfig?.name;
    if (!agentName) {
      return base;
    }

    return `Graph execution was stopped for agent ${agentName}`;
  }

  private readonly handleThreadStateChange = (threadId: string) => {
    if (!threadId) {
      return;
    }

    const activeRun = this.getActiveRunByThread(threadId);
    const runId = activeRun?.runnableConfig.configurable?.run_id;

    this.emitNodeAdditionalMetadataUpdate({
      threadId,
      ...(runId ? { runId } : {}),
    });
  };

  public override getGraphNodeMetadata(
    meta: GraphExecutionMetadata,
  ): Record<string, unknown> | undefined {
    const instructions = this.currentConfig?.instructions;
    const instructionsMeta = instructions
      ? { instructions: instructions.trim() }
      : undefined;

    const allTools = this.getTools();

    const connectivityMeta = {
      connectedTools: allTools.map((t) => ({
        name: t.name,
        description: t.description,
        // Tools in this codebase provide JSONSchema already (see BaseTool.buildToolConfiguration()).
        schema: t.schema,
      })),
    };

    if (!meta?.threadId || !this.graphThreadState) {
      return {
        ...(instructionsMeta ?? {}),
        ...connectivityMeta,
      };
    }

    const threadState = this.graphThreadState.getByThread(meta.threadId);

    return {
      pendingMessages: threadState.pendingMessages.map((msg) => ({
        content: msg.content,
        role: msg.type,
        additionalKwargs: msg.additional_kwargs,
      })),
      reasoningChunks: Array.from(threadState.reasoningChunks.entries()).reduce(
        (res, [id, msg]) => {
          res[id] = {
            content: msg.content,
            id: msg.id,
            role: msg.role,
          };
          return res;
        },
        {} as Record<string, unknown>,
      ),
      ...(instructionsMeta ?? {}),
      ...connectivityMeta,
    };
  }

  public async runOrAppend(
    threadId: string,
    messages: BaseMessage[],
    _config?: SimpleAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    const config = _config ? this.schema.parse(_config) : this.currentConfig;

    if (!config) {
      throw new Error('Agent configuration is required for execution');
    }

    const activeRun = this.getActiveRunByThread(threadId);

    if (!activeRun) {
      return this.run(threadId, messages, config, runnableConfig);
    }

    await this.appendMessages(messages, activeRun);

    return {
      messages: activeRun.lastState.messages,
      threadId,
      checkpointNs: activeRun.runnableConfig?.configurable?.checkpoint_ns,
      needsMoreInfo:
        FinishTool.getStateFromToolsMetadata(activeRun.lastState.toolsMetadata)
          ?.needsMoreInfo === true,
    };
  }

  private extractReasoningFromChunk(chunk: AIMessageChunk): string | null {
    const blocks =
      chunk?.contentBlocks ?? chunk?.response_metadata?.output ?? [];

    if (!Array.isArray(blocks)) {
      return null;
    }

    const reasoningBlocks = blocks.filter(
      (b) =>
        b &&
        b.type === 'reasoning' &&
        typeof b.reasoning === 'string' &&
        b.reasoning.length > 0,
    );

    if (!reasoningBlocks.length) {
      return null;
    }

    return reasoningBlocks.map((b) => b.reasoning).join('\n');
  }

  public async run(
    threadId: string,
    messages: BaseMessage[],
    _config?: SimpleAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    const runId = runnableConfig?.configurable?.run_id || v4();
    const config = _config ? this.schema.parse(_config) : this.currentConfig;

    if (!config) {
      throw new Error('Agent configuration is required for execution');
    }

    const activeRun = this.getActiveRunByThread(threadId);

    if (activeRun) {
      throw new Error('Thread is currently running');
    }

    const configuredIterations = config.maxIterations ?? 25;
    const requestedRecursionLimit = runnableConfig?.recursionLimit;
    const recursionLimit =
      typeof requestedRecursionLimit === 'number'
        ? Math.min(requestedRecursionLimit, configuredIterations)
        : configuredIterations;

    const mergedConfig: RunnableConfig<BaseAgentConfigurable> = {
      ...(runnableConfig ?? {}),
      configurable: {
        ...(runnableConfig?.configurable ?? {}),
        thread_id: threadId,
        caller_agent: this,
        run_id: runId,
      },
      recursionLimit,
    };

    const updateMessages = updateMessagesListWithMetadata(
      messages,
      mergedConfig,
    );
    const inputMessageSet = new Set(updateMessages);

    // Emit invoke event
    this.emit({
      type: 'invoke',
      data: {
        threadId,
        messages: updateMessages,
        config: mergedConfig,
      },
    });

    const g = await this.buildGraph(config);

    this.graphThreadState?.applyForThread(threadId, {
      newMessageMode: config.newMessageMode,
    });

    const abortController = new AbortController();

    // Load checkpoint state BEFORE streaming to get accumulated token/cost values
    // LangGraph checkpointer stores the full state including our custom fields
    let initialState: BaseAgentState = {
      messages: updateMessages,
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

    // Try to load checkpoint state for accumulated values
    try {
      if (
        g.checkpointer &&
        typeof g.checkpointer === 'object' &&
        'getTuple' in g.checkpointer
      ) {
        const checkpointTuple = await g.checkpointer.getTuple(mergedConfig);
        if (
          checkpointTuple &&
          typeof checkpointTuple === 'object' &&
          'checkpoint' in checkpointTuple
        ) {
          const checkpoint = checkpointTuple.checkpoint;
          if (
            checkpoint &&
            typeof checkpoint === 'object' &&
            'channel_values' in checkpoint
          ) {
            const checkpointState =
              checkpoint.channel_values as unknown as BaseAgentState;
            // Use checkpoint's accumulated values, but keep new messages
            initialState = {
              ...initialState,
              inputTokens: checkpointState.inputTokens || 0,
              cachedInputTokens: checkpointState.cachedInputTokens || 0,
              outputTokens: checkpointState.outputTokens || 0,
              reasoningTokens: checkpointState.reasoningTokens || 0,
              totalTokens: checkpointState.totalTokens || 0,
              totalPrice: checkpointState.totalPrice || 0,
              currentContext: checkpointState.currentContext || 0,
            };
          }
        }
      }
    } catch (error) {
      // If we can't load checkpoint, just start with zeros (first run)
      this.logger.debug(
        'Could not load checkpoint, starting with zero counters',
        {
          threadId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    let finalState: BaseAgentState = initialState;

    // Track active run for cancellation and status updates
    const runEntry: ActiveRunEntry = {
      abortController,
      runnableConfig: mergedConfig,
      threadId,
      lastState: finalState,
      stopped: false,
    };

    this.activeRuns.set(runId, runEntry);

    const stream = await g.stream(
      {
        messages: {
          mode: 'append',
          items: updateMessages,
        },
        toolsMetadata: FinishTool.clearState(),
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
      } satisfies BaseAgentStateChange,
      {
        ...mergedConfig,
        streamMode: ['updates', 'messages'],
        signal: abortController.signal,
      },
    );

    // Emit initial messages notification
    await this.emitNewMessages(updateMessages, mergedConfig, threadId);

    try {
      for await (const event of stream) {
        const [mode, value] = event as ['updates' | 'messages', unknown];

        if (mode === 'updates') {
          const chunk = value as Record<string, BaseAgentStateChange>;

          for (const [_nodeName, nodeState] of Object.entries(chunk)) {
            // Update final state - cast to BaseAgentStateChange first, then to BaseAgentState
            const stateChange = nodeState;
            if (!stateChange || typeof stateChange !== 'object') continue;

            const beforeLen = finalState.messages.length;
            const prevMessages = finalState.messages;
            const prevState = { ...finalState };

            // Convert state change to final state for tracking
            finalState = this.applyChange(finalState, stateChange);
            this.syncThreadTotals(threadId, finalState);

            // Persist latest state for potential stop handling
            const runRef = this.activeRuns.get(runId);
            if (runRef) {
              runRef.lastState = finalState;
            }

            // Emit notification for new messages.
            //
            // IMPORTANT:
            // Some nodes (e.g. summarize) use `messages.mode = replace` to shrink the history.
            // In that case, `slice(beforeLen)` can be empty even if the replacement introduced
            // new messages (like a summary system marker). We compute a minimal "new messages"
            // delta for replace-mode updates to avoid losing those messages and to avoid re-emitting
            // the entire tail.
            const newMessages =
              stateChange.messages?.mode === 'replace'
                ? this.diffNewMessages(prevMessages, finalState.messages)
                : finalState.messages.slice(beforeLen);
            await this.emitNewMessages(newMessages, mergedConfig, threadId);

            // Emit state update notification (only changed fields)
            await this.emitStateUpdate(
              prevState,
              finalState,
              mergedConfig,
              threadId,
            );

            if (_nodeName === 'invoke_llm') {
              this.clearReasoningState(threadId);
            }
          }
        } else if (mode === 'messages') {
          const [messageChunk, metadata] = value as [
            AIMessageChunk,
            Record<string, unknown>,
          ];

          if (metadata.langgraph_node === 'invoke_llm') {
            this.handleReasoningChunk(threadId, messageChunk);
          }
        }
      }
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const msg = (err as { message?: string })?.message || '';
      const aborted = abortController.signal.aborted;
      if (
        !aborted ||
        (name !== 'AbortError' && !msg.toLowerCase().includes('abort'))
      ) {
        const error = err as Error;
        this.activeRuns.delete(runId);

        this.emit({
          type: 'run',
          data: { threadId, messages, config: mergedConfig, error },
        });

        throw error;
      }
    } finally {
      this.activeRuns.delete(runId);
      this.clearReasoningState(threadId);
    }

    // If no updates were received, finalState will still be null - use runEntry.lastState as fallback
    const stateForResult = finalState || runEntry.lastState;

    const result = {
      // Preserve historical behavior: the AgentOutput is the *new* messages produced by the run,
      // not the initial user input we already provided to the graph.
      messages: stateForResult.messages.filter((m) => !inputMessageSet.has(m)),
      threadId,
      checkpointNs: mergedConfig?.configurable?.checkpoint_ns,
      needsMoreInfo:
        FinishTool.getStateFromToolsMetadata(stateForResult.toolsMetadata)
          ?.needsMoreInfo === true,
    };

    const wasDone =
      FinishTool.getStateFromToolsMetadata(finalState.toolsMetadata)?.done ===
      true;
    const wasStopped = Boolean(runEntry.stopped) && !wasDone;
    const stopError = wasStopped
      ? new Error(runEntry.stopReason ?? this.formatStoppedReason())
      : undefined;

    // Emit run event with result or stop error so thread status can be updated
    const runEvent: AgentRunEvent = {
      threadId,
      messages,
      config: mergedConfig,
    };

    if (stopError) {
      runEvent.error = stopError;
    } else {
      runEvent.result = result;
    }

    this.emit({
      type: 'run',
      data: runEvent,
    });

    return result;
  }

  public async stop(): Promise<void> {
    for (const [runId, run] of this.activeRuns.entries()) {
      const graphId = run.runnableConfig?.configurable?.graph_id;
      const isDone =
        FinishTool.getStateFromToolsMetadata(run.lastState.toolsMetadata)
          ?.done === true;
      if (graphId && !isDone) {
        const msg = markMessageHideForLlm(
          new SystemMessage(this.formatStoppedReason()),
        );
        const msgs = updateMessagesListWithMetadata([msg], run.runnableConfig);

        // Emit message event
        this.emit({
          type: 'message',
          data: {
            threadId: run.threadId,
            messages: msgs,
            config: run.runnableConfig,
          },
        });

        this.emit({
          type: 'stop',
          data: { config: run.runnableConfig, threadId: run.threadId },
        });
      }

      run.stopped = true;
      run.stopReason ??= this.formatStoppedReason(run.stopReason);

      try {
        run.abortController.abort();
      } catch {
        // noop
      }

      this.activeRuns.delete(runId);
    }

    this.graph = undefined;
    this.currentConfig = undefined;
    this.graphThreadStateUnsubscribe?.();
    this.graphThreadStateUnsubscribe = undefined;
    this.graphThreadState = undefined;

    // MCP cleanup is handled by GraphCompiler
  }

  /**
   * Stop execution for a specific thread (best effort).
   * This aborts any active runs whose thread_id or parent_thread_id matches the provided threadId.
   */
  public async stopThread(threadId: string, reason?: string): Promise<void> {
    for (const [_runId, run] of this.activeRuns.entries()) {
      const cfg = run.runnableConfig?.configurable;
      const runThreadId = run.threadId;
      const parentThreadId = cfg?.parent_thread_id;

      const matches = runThreadId === threadId || parentThreadId === threadId;
      if (!matches) {
        continue;
      }

      const isDone =
        FinishTool.getStateFromToolsMetadata(run.lastState.toolsMetadata)
          ?.done === true;
      if (cfg?.graph_id && !isDone) {
        const msg = markMessageHideForLlm(
          new SystemMessage(this.formatStoppedReason(reason)),
        );
        const msgs = updateMessagesListWithMetadata([msg], run.runnableConfig);

        // Emit message event so the user can see the stop reason in thread history
        this.emit({
          type: 'message',
          data: {
            threadId: run.threadId,
            messages: msgs,
            config: run.runnableConfig,
          },
        });

        // Emit stop event so GraphStateManager can deterministically emit ThreadUpdate(Sto pped)
        // even if the underlying LangGraph run is aborted before it reaches the final `run` event.
        this.emit({
          type: 'stop',
          data: { config: run.runnableConfig, threadId: run.threadId },
        });

        // Best-effort: if the agent already decided to call the shell tool but the run is being
        // stopped before the tool result is persisted, emit a deterministic aborted shell result.
        // This makes "stop while a shell command is in-flight" observable in thread history.
        const hasShellTool = this.hasTool('shell');

        if (hasShellTool) {
          const pendingShellCall = [...run.lastState.messages]
            .reverse()
            .filter((m) => m instanceof AIMessage)
            .flatMap((m) => (m as AIMessage).tool_calls ?? [])
            .find((tc) => tc?.name === 'shell');

          if (pendingShellCall) {
            const callId = pendingShellCall?.id ?? '';

            const abortedShell = new ToolMessage({
              tool_call_id: callId,
              name: 'shell',
              content: JSON.stringify({
                exitCode: 124,
                stdout: '',
                stderr: 'Aborted',
                fail: true,
              }),
            });

            this.emit({
              type: 'message',
              data: {
                threadId: run.threadId,
                messages: updateMessagesListWithMetadata(
                  [abortedShell],
                  run.runnableConfig,
                ),
                config: run.runnableConfig,
              },
            });
          }
        }
      }

      run.stopped = true;
      run.stopReason ??= this.formatStoppedReason(reason);

      try {
        run.abortController.abort();
      } catch {
        // noop
      }

      // DO NOT delete from activeRuns here - let the stream's finally block handle cleanup
      // This ensures the stopped flag is checked and proper events are emitted
    }
  }

  /**
   * Update the agent's configuration without destroying the instance.
   * The graph will be rebuilt on the next run() call with the new config.
   */
  public setConfig(config: SimpleAgentSchemaType): void {
    // Validate the config against the schema
    const parsedConfig = this.schema.parse(config);

    // Clear the graph so it will be rebuilt with new config
    this.graph = undefined;
    this.currentConfig = parsedConfig;
    this.graphThreadStateUnsubscribe?.();
    this.graphThreadStateUnsubscribe = undefined;
    this.graphThreadState = undefined;
  }

  public getConfig(): SimpleAgentSchemaType {
    if (!this.currentConfig) {
      throw new Error('Agent config not initialized');
    }
    return this.currentConfig;
  }

  /**
   * Set MCP services for this agent.
   * Called by the template during agent creation to inject MCP services from connected nodes.
   */
  public setMcpServices(mcpServices: BaseMcp<unknown>[]): void {
    this.mcpServices = mcpServices;
  }

  private hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tools (including MCP tools after they're discovered)
   */
  public getTools(): DynamicStructuredTool[] {
    return Array.from(this.tools.values());
  }
}
