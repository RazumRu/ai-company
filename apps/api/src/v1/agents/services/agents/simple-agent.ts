import {
  AIMessage,
  BaseMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
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

import { FinishTool } from '../../../agent-tools/tools/finish.tool';
import { GraphExecutionMetadata } from '../../../graphs/graphs.types';
import {
  BaseAgentState,
  BaseAgentStateChange,
  BaseAgentStateMessagesUpdateValue,
  NewMessageMode,
} from '../../agents.types';
import {
  markMessageHideForLlm,
  updateMessagesListWithMetadata,
} from '../../agents.utils';
import { RegisterAgent } from '../../decorators/register-agent.decorator';
import { GraphThreadState, IGraphThreadStateData } from '../graph-thread-state';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { InjectPendingNode } from '../nodes/inject-pending-node';
import { InvokeLlmNode } from '../nodes/invoke-llm-node';
import { SummarizeNode } from '../nodes/summarize-node';
import { TitleGenerationNode } from '../nodes/title-generation-node';
import { ToolExecutorNode } from '../nodes/tool-executor-node';
import { ToolUsageGuardNode } from '../nodes/tool-usage-guard-node';
import { PgCheckpointSaver } from '../pg-checkpoint-saver';
import { AgentOutput, BaseAgent } from './base-agent';

export const SimpleAgentSchema = z.object({
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
      'Token budget reserved for the most recent messages kept verbatim when summarizing (the “tail”).',
    ),
  instructions: z
    .string()
    .describe(
      'System prompt injected at the start of each turn: role, goals, constraints, style.',
    )
    .meta({ 'x-ui:textarea': true }),
  invokeModelName: z
    .string()
    .default('gpt-5.1')
    .describe('Chat model used for the main reasoning/tool-call step.')
    .meta({ 'x-ui:show-on-node': true }),
  enforceToolUsage: z
    .boolean()
    .optional()
    .describe(
      'If true, enforces that the agent must call a tool before finishing. Uses tool_usage_guard node to inject system messages requiring tool calls.',
    ),
  maxIterations: z
    .number()
    .int()
    .min(1)
    .max(2500)
    .default(2500)
    .optional()
    .describe(
      'Maximum number of iterations the agent can execute during a single run.',
    )
    .meta({ 'x-ui:show-on-node': true }),
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
};

@Injectable({ scope: Scope.TRANSIENT })
@RegisterAgent()
export class SimpleAgent extends BaseAgent<SimpleAgentSchemaType> {
  private graph?: CompiledStateGraph<BaseAgentState, Record<string, unknown>>;
  private graphThreadState?: GraphThreadState;
  private graphThreadStateUnsubscribe?: () => void;
  private currentConfig?: SimpleAgentSchemaType;
  private activeRuns = new Map<string, ActiveRunEntry>();

  constructor(
    private readonly checkpointer: PgCheckpointSaver,
    private readonly logger: DefaultLogger,
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
        reducer: (left, right) => right ?? left,
        default: () => '',
      }),
      done: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
      needsMoreInfo: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
      toolUsageGuardActivatedCount: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
      toolUsageGuardActivated: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
      generatedTitle: Annotation<string | undefined, string | undefined>({
        reducer: (left, right) => right ?? left,
        default: () => undefined,
      }),
    } satisfies Record<
      keyof BaseAgentState,
      BaseChannel | (() => BaseChannel)
    >);
  }

  protected buildGraph(config: SimpleAgentSchemaType) {
    if (!this.graph) {
      const graphThreadState = new GraphThreadState();
      this.graphThreadStateUnsubscribe?.();
      this.graphThreadStateUnsubscribe = graphThreadState.subscribe(
        this.handleThreadStateChange,
      );

      // Apply defaults for optional fields
      const enforceToolUsage = config.enforceToolUsage ?? true;

      if (enforceToolUsage) {
        this.addTool(new FinishTool().build({}));
      }

      // ---- summarize ----
      const summarizeNode = new SummarizeNode(
        this.buildLLM('gpt-5-mini'),
        {
          maxTokens: config.summarizeMaxTokens,
          keepTokens: config.summarizeKeepTokens,
        },
        this.logger,
      );

      // ---- invoke ----
      const tools = this.tools;
      const invokeLlmNode = new InvokeLlmNode(
        this.buildLLM(config.invokeModelName),
        tools,
        {
          systemPrompt: config.instructions,
          toolChoice: 'auto',
          parallelToolCalls: true,
        },
        this.logger,
      );

      // ---- tool executor ----
      const toolExecutorNode = new ToolExecutorNode(
        tools,
        undefined,
        this.logger,
      );

      // ---- message injection ----
      const injectPendingNode = new InjectPendingNode(
        graphThreadState,
        this.logger,
      );

      // ---- title generation ----
      const titleGenerationNode = new TitleGenerationNode(
        this.buildLLM('gpt-5-mini'),
        this.logger,
      );

      // ---- build ----
      const g = new StateGraph({
        stateSchema: this.buildState(),
      })
        .addNode('summarize', summarizeNode.invoke.bind(summarizeNode))
        .addNode(
          'generate_title',
          titleGenerationNode.invoke.bind(titleGenerationNode),
        )
        .addNode('invoke_llm', invokeLlmNode.invoke.bind(invokeLlmNode))
        .addNode('tools', toolExecutorNode.invoke.bind(toolExecutorNode))
        .addNode(
          'inject_pending',
          injectPendingNode.invoke.bind(injectPendingNode),
        )
        // ---- routing ----
        .addEdge(START, 'generate_title')
        .addEdge('generate_title', 'summarize')
        .addEdge('summarize', 'invoke_llm');

      // ---- conditional tool usage guard ----
      if (enforceToolUsage) {
        // ---- tool usage guard ----
        const toolUsageGuardNode = new ToolUsageGuardNode(
          {
            getRestrictOutput: () => true,
            getRestrictionMessage: () =>
              "You must call a tool before finishing. If you have completed the task or have a final answer, call the 'finish' tool. If you need more information from the user, call the 'finish' tool with needsMoreInfo set to true and include your question in the message. Never provide a direct text response without calling a tool first.",
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
            (s) =>
              ((s.messages.at(-1) as AIMessage)?.tool_calls?.length ?? 0) > 0
                ? 'tools'
                : 'tool_usage_guard',
            { tools: 'tools', tool_usage_guard: 'tool_usage_guard' },
          )
          .addConditionalEdges(
            'tool_usage_guard',
            (s) => (s.toolUsageGuardActivated ? 'invoke_llm' : END),
            { invoke_llm: 'invoke_llm', [END]: END },
          );
      } else {
        g.addConditionalEdges(
          'invoke_llm',
          (s, cfg) => {
            const last = s.messages.at(-1) as AIMessage | undefined;
            const hasTools = (last?.tool_calls?.length ?? 0) > 0;

            if (hasTools) {
              return 'tools';
            }

            const threadId = String(cfg.configurable?.thread_id ?? '');
            const { pendingMessages } = graphThreadState.getByThread(threadId);
            const hasPending = pendingMessages.length > 0;

            if (hasPending) {
              return 'inject_pending';
            }

            return END;
          },
          {
            tools: 'tools',
            inject_pending: 'inject_pending',
            [END]: END,
          },
        );
      }

      g.addConditionalEdges(
        'tools',
        (s, cfg) => {
          const threadId = String(cfg.configurable?.thread_id ?? '');
          const { pendingMessages, newMessageMode } =
            graphThreadState.getByThread(threadId);

          const hasPending = pendingMessages.length > 0;
          const mode = newMessageMode ?? NewMessageMode.InjectAfterToolCall;
          const isComplete = s.done || s.needsMoreInfo;

          if (!isComplete) {
            if (mode === NewMessageMode.InjectAfterToolCall && hasPending) {
              return 'inject_pending';
            }

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
      ).addEdge('inject_pending', 'summarize');

      this.graph = g.compile({
        checkpointer: this.checkpointer,
      }) as CompiledStateGraph<BaseAgentState, Record<string, unknown>>;
      this.graphThreadState = graphThreadState;
    }

    return this.graph;
  }

  private buildInitialState(): BaseAgentState {
    return {
      messages: [],
      summary: '',
      done: false,
      needsMoreInfo: false,
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
      generatedTitle: undefined,
    };
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
      done: change.done ?? prev.done,
      needsMoreInfo: change.needsMoreInfo ?? prev.needsMoreInfo,
      toolUsageGuardActivated:
        change.toolUsageGuardActivated ?? prev.toolUsageGuardActivated,
      toolUsageGuardActivatedCount:
        change.toolUsageGuardActivatedCount ??
        prev.toolUsageGuardActivatedCount,
      generatedTitle: change.generatedTitle ?? prev.generatedTitle,
    };
  }

  private async emitNewMessages(
    messages: BaseMessage[],
    rc: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    if (!rc?.configurable?.graph_id) return;
    const runId = rc.configurable.run_id;

    const fresh = messages.filter((m) => m.additional_kwargs?.run_id === runId);

    if (fresh.length > 0) {
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

  private async emitStateUpdate(
    prevState: BaseAgentState,
    nextState: BaseAgentState,
    runnableConfig: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    if (!runnableConfig?.configurable?.graph_id) return;

    // Build state change object with only changed fields
    const stateChange: Partial<BaseAgentState> = {};

    if (prevState.generatedTitle !== nextState.generatedTitle) {
      stateChange.generatedTitle = nextState.generatedTitle;
    }

    if (prevState.summary !== nextState.summary) {
      stateChange.summary = nextState.summary;
    }

    if (prevState.done !== nextState.done) {
      stateChange.done = nextState.done;
    }

    if (prevState.needsMoreInfo !== nextState.needsMoreInfo) {
      stateChange.needsMoreInfo = nextState.needsMoreInfo;
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

    // Only emit if there are changes
    if (Object.keys(stateChange).length === 0) return;

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

  private readonly handleThreadStateChange = (
    threadId: string,
    nextState: IGraphThreadStateData,
    prevState?: IGraphThreadStateData,
  ) => {
    if (!threadId) {
      return;
    }

    const prevPending = prevState?.pendingMessages ?? [];
    const nextPending = nextState.pendingMessages;
    const pendingLengthChanged = prevPending.length !== nextPending.length;
    const pendingContentChanged =
      !pendingLengthChanged &&
      prevPending.some((message, index) => message !== nextPending[index]);
    const modeChanged = prevState?.newMessageMode !== nextState.newMessageMode;

    if (!pendingLengthChanged && !pendingContentChanged && !modeChanged) {
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
    if (!meta?.threadId || !this.graphThreadState) {
      return undefined;
    }

    const threadState = this.graphThreadState.getByThread(meta.threadId);
    if (!threadState.pendingMessages.length) {
      return undefined;
    }

    return {
      pendingMessages: threadState.pendingMessages,
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
      needsMoreInfo: activeRun.lastState.needsMoreInfo,
    };
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

    // Emit invoke event
    this.emit({
      type: 'invoke',
      data: {
        threadId,
        messages: updateMessages,
        config: mergedConfig,
      },
    });

    const g = this.buildGraph(config);

    this.graphThreadState?.applyForThread(threadId, {
      newMessageMode: config.newMessageMode,
    });

    const abortController = new AbortController();

    let finalState: BaseAgentState = this.buildInitialState();

    // Track active run for cancellation and status updates
    this.activeRuns.set(runId, {
      abortController,
      runnableConfig: mergedConfig,
      threadId,
      lastState: finalState,
    });

    // Use stream instead of invoke to capture messages
    // Reset flags from previous run to ensure fresh execution
    const stream = await g.stream(
      {
        messages: {
          mode: 'append',
          items: updateMessages,
        },
        done: false,
        needsMoreInfo: false,
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
      } satisfies BaseAgentStateChange,
      {
        ...mergedConfig,
        streamMode: 'updates',
        signal: abortController.signal,
      },
    );

    try {
      // Process stream chunks and emit message notifications
      for await (const chunk of stream) {
        // chunk is a record of node outputs: { [nodeName]: nodeState }
        for (const [_nodeName, nodeState] of Object.entries(chunk)) {
          // Update final state - cast to BaseAgentStateChange first, then to BaseAgentState
          const stateChange = nodeState as BaseAgentStateChange;
          if (!stateChange || typeof stateChange !== 'object') continue;

          const beforeLen = finalState.messages.length;
          const prevState = { ...finalState };

          // Convert state change to final state for tracking
          finalState = this.applyChange(finalState, stateChange);

          // Persist latest state for potential stop handling
          const runRef = this.activeRuns.get(runId);
          if (runRef) {
            runRef.lastState = finalState;
          }

          // Emit notification for new messages
          await this.emitNewMessages(
            finalState.messages.slice(beforeLen),
            mergedConfig,
            threadId,
          );

          // Emit state update notification (only changed fields)
          await this.emitStateUpdate(
            prevState,
            finalState,
            mergedConfig,
            threadId,
          );
        }
      }
    } catch (err) {
      // Swallow abort-related errors to allow graceful stop
      const name = (err as unknown as { name?: string })?.name;
      const msg = (err as unknown as { message?: string })?.message || '';
      const aborted = abortController.signal.aborted;
      if (
        !aborted ||
        (name !== 'AbortError' && !msg.toLowerCase().includes('abort'))
      ) {
        const error = err as Error;
        this.activeRuns.delete(runId);

        // Emit run event with error
        this.emit({
          type: 'run',
          data: { threadId, messages, config: mergedConfig, error },
        });

        throw error;
      }
    } finally {
      this.activeRuns.delete(runId);
    }

    const result = {
      messages: finalState.messages,
      threadId,
      checkpointNs: mergedConfig?.configurable?.checkpoint_ns,
      needsMoreInfo: finalState.needsMoreInfo,
    };

    // Emit run event with result
    this.emit({
      type: 'run',
      data: { threadId, messages, config: mergedConfig, result },
    });

    return result;
  }

  public async stop(): Promise<void> {
    for (const [runId, run] of this.activeRuns.entries()) {
      const graphId = run.runnableConfig?.configurable?.graph_id;
      if (graphId && !run.lastState.done) {
        const msg = markMessageHideForLlm(
          new SystemMessage('Graph execution was stopped'),
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
}
