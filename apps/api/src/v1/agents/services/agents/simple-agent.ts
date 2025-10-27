import { AIMessage, BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  Annotation,
  BaseChannel,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { FinishTool } from '../../../agent-tools/tools/finish.tool';
import { NotificationEvent } from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import {
  BaseAgentState,
  BaseAgentStateChange,
  BaseAgentStateMessagesUpdateValue,
} from '../../agents.types';
import { RegisterAgent } from '../../decorators/register-agent.decorator';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { InvokeLlmNode } from '../nodes/invoke-llm-node';
import { SummarizeNode } from '../nodes/summarize-node';
import { ToolExecutorNode } from '../nodes/tool-executor-node';
import { ToolUsageGuardNode } from '../nodes/tool-usage-guard-node';
import { PgCheckpointSaver } from '../pg-checkpoint-saver';
import { AgentOutput, BaseAgent } from './base-agent';

export const SimpleAgentSchema = z.object({
  summarizeMaxTokens: z
    .number()
    .optional()
    .default(100000)
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
  constructor(
    private readonly checkpointer: PgCheckpointSaver,
    private readonly logger: DefaultLogger,
    private readonly notificationsService: NotificationsService,
  ) {
    super();

    this.addTool(new FinishTool().build({}));
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
      toolUsageGuardActivatedCount: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
      toolUsageGuardActivated: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
    } satisfies Record<
      keyof BaseAgentState,
      BaseChannel | (() => BaseChannel)
    >);
  }

  protected buildGraph(config: SimpleAgentSchemaType) {
    // Apply defaults for optional fields
    const enforceToolUsage = config.enforceToolUsage ?? true;

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

    // ---- build ----
    const g = new StateGraph({
      stateSchema: this.buildState(),
    })
      .addNode('summarize', summarizeNode.invoke.bind(summarizeNode))
      .addNode('invoke_llm', invokeLlmNode.invoke.bind(invokeLlmNode))
      .addNode('tools', toolExecutorNode.invoke.bind(toolExecutorNode))
      // ---- routing ----
      .addEdge(START, 'summarize')
      .addEdge('summarize', 'invoke_llm');

    // ---- conditional tool usage guard ----
    if (enforceToolUsage) {
      // ---- tool usage guard ----
      const toolUsageGuardNode = new ToolUsageGuardNode(
        {
          getRestrictOutput: () => true,
          getRestrictionMessage: () =>
            "Do not produce a final answer directly. Before finishing, call a tool. If no tool is needed, call the 'finish' tool.",
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

    g.addConditionalEdges('tools', (s) => (s.done ? END : 'summarize'), {
      summarize: 'summarize',
      [END]: END,
    });

    return g.compile({ checkpointer: this.checkpointer });
  }

  private buildInitialState(): BaseAgentState {
    return {
      messages: [],
      summary: '',
      done: false,
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
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
      toolUsageGuardActivated:
        change.toolUsageGuardActivated ?? prev.toolUsageGuardActivated,
      toolUsageGuardActivatedCount:
        change.toolUsageGuardActivatedCount ??
        prev.toolUsageGuardActivatedCount,
    };
  }

  private async emitNewMessages(
    prevLen: number,
    nextState: BaseAgentState,
    runnableConfig: RunnableConfig<BaseAgentConfigurable> | undefined,
    threadId: string,
  ) {
    const graphId = runnableConfig?.configurable?.graph_id;
    if (!graphId) return;

    const nodeId = runnableConfig?.configurable?.node_id || 'unknown';
    const parentThreadId =
      runnableConfig?.configurable?.parent_thread_id || 'unknown';

    const newMessages = nextState.messages.slice(prevLen);
    if (newMessages.length === 0) return;

    // Emit notification for each new message
    for (const message of newMessages) {
      await this.notificationsService.emit({
        type: NotificationEvent.AgentMessage,
        graphId,
        nodeId,
        threadId,
        parentThreadId,
        data: {
          messages: [message],
        },
      });
    }
  }

  public async run(
    threadId: string,
    messages: BaseMessage[],
    config: SimpleAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    // Emit AgentInvoke notification
    if (runnableConfig?.configurable?.graph_id) {
      await this.notificationsService.emit({
        type: NotificationEvent.AgentInvoke,
        graphId: runnableConfig.configurable.graph_id,
        nodeId: runnableConfig.configurable.node_id || 'unknown',
        threadId,
        parentThreadId:
          runnableConfig.configurable.parent_thread_id || 'unknown',
        data: {
          messages,
        },
      });
    }

    const g = this.buildGraph(config);

    const merged: RunnableConfig<BaseAgentConfigurable> = {
      ...(runnableConfig ?? {}),
      configurable: {
        ...(runnableConfig?.configurable ?? {}),
        thread_id: threadId,
        caller_agent: this,
      },
      recursionLimit: runnableConfig?.recursionLimit ?? 2500,
    };

    // Use stream instead of invoke to capture messages
    const stream = await g.stream(
      {
        messages: {
          mode: 'append',
          items: messages,
        },
      },
      {
        ...merged,
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

        // Convert state change to final state for tracking
        finalState = this.applyChange(finalState, stateChange);

        // Emit notification for new messages
        await this.emitNewMessages(
          beforeLen,
          finalState,
          runnableConfig,
          threadId,
        );
      }
    }

    return {
      messages: finalState.messages,
      threadId,
      checkpointNs: runnableConfig?.configurable?.checkpoint_ns,
    };
  }
}
