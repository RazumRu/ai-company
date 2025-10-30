import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  trimMessages,
} from '@langchain/core/messages';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { DefaultLogger } from '@packages/common';

import { BaseAgentState, BaseAgentStateChange } from '../../agents.types';
import { updateMessagesListWithMetadata } from '../../agents.utils';
import { BaseAgentConfigurable, BaseNode } from './base-node';

type SummarizeOpts = {
  keepTokens: number;
  maxTokens: number;
  systemNote?: string;
};

export class SummarizeNode extends BaseNode<
  BaseAgentState,
  BaseAgentStateChange
> {
  constructor(
    private llm: ChatOpenAI,
    private opts: SummarizeOpts,
    private readonly logger?: DefaultLogger,
  ) {
    super();
  }

  async invoke(
    state: BaseAgentState,
    cfg: LangGraphRunnableConfig<BaseAgentConfigurable>,
  ): Promise<BaseAgentStateChange> {
    const { maxTokens, keepTokens } = this.opts;
    if (maxTokens <= 0) {
      return {
        messages: { mode: 'replace', items: state.messages },
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
      };
    }

    const totalNow =
      (await this.countTokens(state.messages)) +
      (state.summary ? await this.countTokens(state.summary) : 0);

    if (totalNow <= maxTokens) {
      return {
        messages: {
          mode: 'replace',
          items: updateMessagesListWithMetadata(
            this.clean(state.messages),
            cfg,
          ),
        },
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
      };
    }

    let tail: BaseMessage[];
    if (keepTokens > 0) {
      tail = await trimMessages({
        strategy: 'last',
        tokenCounter: this.llm!,
        maxTokens: keepTokens,
        startOn: ['human', 'ai', 'tool', 'system'],
        endOn: ['human', 'ai', 'tool', 'system'],
        allowPartial: false,
      }).invoke(state.messages);
    } else {
      tail = state.messages.length
        ? [state.messages[state.messages.length - 1]!]
        : [];
    }

    const older = state.messages.slice(0, state.messages.length - tail.length);
    const newSummary = older.length
      ? await this.fold(state.summary, older)
      : state.summary;

    const summaryCost = newSummary ? await this.countTokens(newSummary) : 0;
    const remaining = Math.max(0, maxTokens - summaryCost);
    const finalTail =
      remaining > 0
        ? await trimMessages({
            strategy: 'last',
            tokenCounter: this.llm!,
            maxTokens: remaining,
            startOn: ['human', 'ai', 'tool', 'system'],
            endOn: ['human', 'ai', 'tool', 'system'],
            allowPartial: false,
          }).invoke(tail)
        : [];

    return {
      messages: {
        mode: 'replace',
        items: updateMessagesListWithMetadata(this.clean(finalTail), cfg),
      },
      summary: newSummary || '',
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
    };
  }

  private async countTokens(x: BaseMessage[] | string): Promise<number> {
    if (typeof x === 'string') {
      try {
        return await this.llm!.getNumTokens(x);
      } catch {
        return x.length;
      }
    }
    let t = 0;
    for (const m of x) {
      const c =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      try {
        t += await this.llm!.getNumTokens(c);
      } catch {
        t += c.length;
      }
    }
    return t;
  }

  private async fold(
    prev: string | undefined,
    older: BaseMessage[],
  ): Promise<string> {
    const sys = new SystemMessage(
      this.opts.systemNote ||
        'You update a running summary of a conversation. Keep key facts, goals, decisions, constraints, names, deadlines, and follow-ups. Be concise; use compact sentences; omit chit-chat.',
    );
    const lines = older
      .map(
        (m) =>
          `${m.getType().toUpperCase()}: ${
            typeof m.content === 'string'
              ? m.content
              : JSON.stringify(m.content)
          }`,
      )
      .join('\n');
    const human = new HumanMessage(
      `Previous summary:\n${prev ?? '(none)'}\n\nFold in the following messages:\n${lines}\n\nReturn only the updated summary.`,
    );
    const res = (await this.llm!.invoke([sys, human])) as AIMessage;
    return typeof res.content === 'string'
      ? res.content
      : JSON.stringify(res.content);
  }

  private clean(msgs: BaseMessage[]): BaseMessage[] {
    const toolIds = new Set(
      msgs.filter((m) => m instanceof ToolMessage).map((m) => m.tool_call_id),
    );
    return msgs.filter(
      (m) =>
        !(m instanceof AIMessage) ||
        !m.tool_calls?.length ||
        m.tool_calls.every((tc) => toolIds.has(tc.id ?? '')),
    );
  }
}
