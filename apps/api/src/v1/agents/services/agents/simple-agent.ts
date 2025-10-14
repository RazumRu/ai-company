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
import {
  BaseAgentState,
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
    .default(4096)
    .describe(
      'Total token budget for summary + recent context. If current history exceeds this, older messages are folded into the rolling summary.',
    ),
  summarizeKeepTokens: z
    .number()
    .optional()
    .default(1024)
    .describe(
      'Token budget reserved for the most recent messages kept verbatim when summarizing (the “tail”).',
    ),
  instructions: z
    .string()
    .describe(
      'System prompt injected at the start of each turn: role, goals, constraints, style.',
    ),
  name: z.string().describe('Agent name.'),
  invokeModelName: z
    .string()
    .default('gpt-5')
    .describe('Chat model used for the main reasoning/tool-call step.'),
  enforceToolUsage: z
    .boolean()
    .optional()
    .describe(
      'If true, enforces that the agent must call a tool before finishing. Uses tool_usage_guard node to inject system messages requiring tool calls. Defaults to true.',
    ),
});

export type SimpleAgentSchemaType = z.infer<typeof SimpleAgentSchema>;

@Injectable({ scope: Scope.TRANSIENT })
@RegisterAgent()
export class SimpleAgent extends BaseAgent<SimpleAgentSchemaType> {
  constructor(
    private readonly checkpointer: PgCheckpointSaver,
    private readonly logger: DefaultLogger,
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

  public async run(
    threadId: string,
    messages: BaseMessage[],
    config: SimpleAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    this.logger.debug('simple-agent.run.start', {
      threadId,
      messageCount: messages.length,
      model: config.invokeModelName,
      agentName: config.name,
    });

    const g = this.buildGraph(config);

    const merged: RunnableConfig<BaseAgentConfigurable> = {
      ...(runnableConfig ?? {}),
      configurable: {
        thread_id: threadId,
        caller_agent: this,
        ...(runnableConfig?.configurable ?? {}),
      },
      recursionLimit: runnableConfig?.recursionLimit ?? 2500,
    };

    const response = await g.invoke(
      {
        messages: {
          mode: 'append',
          items: messages,
        },
      },
      merged,
    );

    this.logger.debug('simple-agent.run.complete', {
      threadId,
      responseMessageCount: response.messages.length,
      done: response.done,
    });

    return {
      messages: response.messages,
      threadId,
      checkpointNs: runnableConfig?.configurable?.checkpoint_ns,
    };
  }
}
