import { AIMessage, BaseMessage } from '@langchain/core/messages';
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
import { NotificationEvent } from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import {
  BaseAgentState,
  BaseAgentStateChange,
  BaseAgentStateMessagesUpdateValue,
} from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { RegisterAgent } from '../../decorators/register-agent.decorator';
import { BaseAgentConfigurable } from '../nodes/base-node';
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
    .default(200000)
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
    .default('gpt-5')
    .describe('Chat model used for the main reasoning/tool-call step.')
    .meta({ 'x-ui:show-on-node': true }),
  enforceToolUsage: z
    .boolean()
    .optional()
    .describe(
      'If true, enforces that the agent must call a tool before finishing. Uses tool_usage_guard node to inject system messages requiring tool calls.',
    ),
});

export type SimpleAgentSchemaType = z.infer<typeof SimpleAgentSchema>;

@Injectable({ scope: Scope.TRANSIENT })
@RegisterAgent()
export class SimpleAgent extends BaseAgent<SimpleAgentSchemaType> {
  private graph?: CompiledStateGraph<BaseAgentState, Record<string, unknown>>;

  constructor(
    private readonly checkpointer: PgCheckpointSaver,
    private readonly logger: DefaultLogger,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
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
            getRestrictionMaxInjections: () => 2,
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
        // Without tool usage guard, go directly to tools or END
        g.addConditionalEdges(
          'invoke_llm',
          (s) =>
            ((s.messages.at(-1) as AIMessage)?.tool_calls?.length ?? 0) > 0
              ? 'tools'
              : END,
          { tools: 'tools', [END]: END },
        );
      }

      g.addConditionalEdges(
        'tools',
        (s) => {
          // If done is explicitly set, end
          if (s.done) {
            return END;
          }

          // If needsMoreInfo is set, stop execution and wait for user input
          if (s.needsMoreInfo) {
            return END;
          }

          // Otherwise, continue to summarize
          return 'summarize';
        },
        {
          summarize: 'summarize',
          [END]: END,
        },
      );

      this.graph = g.compile({
        checkpointer: this.checkpointer,
      }) as CompiledStateGraph<BaseAgentState, Record<string, unknown>>;
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
    const graphId = rc?.configurable?.graph_id;
    if (!graphId) return;
    const runId = rc?.configurable?.run_id;
    const nodeId = rc?.configurable?.node_id || 'unknown';
    const parentThreadId = rc?.configurable?.parent_thread_id || 'unknown';

    const fresh = messages.filter((m) => m.additional_kwargs?.run_id === runId);

    for (const message of fresh) {
      await this.notificationsService.emit({
        type: NotificationEvent.AgentMessage,
        graphId,
        nodeId,
        threadId,
        parentThreadId,
        data: { messages: [message] },
      });
    }
  }

  private async emitStateUpdate(
    prevState: BaseAgentState,
    nextState: BaseAgentState,
    runnableConfig: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    const graphId = runnableConfig?.configurable?.graph_id;
    if (!graphId) return;

    const nodeId = runnableConfig?.configurable?.node_id || 'unknown';
    const parentThreadId =
      runnableConfig?.configurable?.parent_thread_id || 'unknown';

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

    await this.notificationsService.emit({
      type: NotificationEvent.AgentStateUpdate,
      graphId,
      nodeId,
      threadId,
      parentThreadId,
      data: stateChange,
    });
  }

  public async run(
    threadId: string,
    messages: BaseMessage[],
    config: SimpleAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    const runId = runnableConfig?.configurable?.run_id || v4();

    const mergedConfig: RunnableConfig<BaseAgentConfigurable> = {
      ...(runnableConfig ?? {}),
      configurable: {
        ...(runnableConfig?.configurable ?? {}),
        thread_id: threadId,
        caller_agent: this,
        run_id: runId,
      },
      recursionLimit: runnableConfig?.recursionLimit ?? 2500,
    };

    const updateMessages = updateMessagesListWithMetadata(
      messages,
      mergedConfig,
    );

    // Emit AgentInvoke notification
    if (mergedConfig?.configurable?.graph_id) {
      await this.notificationsService.emit({
        type: NotificationEvent.AgentInvoke,
        graphId: mergedConfig.configurable.graph_id,
        nodeId: mergedConfig.configurable.node_id || 'unknown',
        threadId,
        parentThreadId: mergedConfig.configurable.parent_thread_id || 'unknown',
        source: mergedConfig.configurable.source,
        data: {
          messages: updateMessages,
        },
      });
    }

    const g = this.buildGraph(config);

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
      },
      {
        ...mergedConfig,
        streamMode: 'updates',
      },
    );

    let finalState: BaseAgentState = this.buildInitialState();

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

    return {
      messages: finalState.messages,
      threadId,
      checkpointNs: mergedConfig?.configurable?.checkpoint_ns,
      needsMoreInfo: finalState.needsMoreInfo,
    };
  }
}
