import { Injectable } from '@nestjs/common';
import dedent from 'dedent';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { SubagentsToolGroupConfig } from './subagents.types';
import { SubagentsListTool } from './subagents-list.tool';
import { SubagentsRunTaskTool } from './subagents-run-task.tool';

@Injectable()
export class SubagentsToolGroup extends BaseToolGroup<SubagentsToolGroupConfig> {
  constructor(
    private readonly subagentsListTool: SubagentsListTool,
    private readonly subagentsRunTaskTool: SubagentsRunTaskTool,
  ) {
    super();
  }

  protected buildToolsInternal(
    config: SubagentsToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    return [
      this.subagentsListTool.build(config, lgConfig),
      this.subagentsRunTaskTool.build(config, lgConfig),
    ];
  }

  public getDetailedInstructions(): string {
    return dedent`
      ### Subagents — Your Primary Delegation Tool
      Subagents are lightweight autonomous agents that run in their own context window.
      **You should actively delegate tasks to subagents** to keep your own context clean and reduce token usage.
      Each subagent runs independently, processes potentially large outputs internally, and returns only a concise summary to you.

      ### CRITICAL: Default to Delegation
      **Prefer delegating over doing it yourself** for any task that would require more than 1-2 tool calls.
      Subagents protect your main context window from verbose outputs (file contents, search results, command output).
      Only handle things directly when they are truly trivial (reading a single known file, one quick command).

      ### When You MUST Delegate
      Always use subagents for these scenarios — do NOT attempt them yourself:
      - **Codebase exploration**: Understanding project structure, finding implementations, tracing code paths → "system:explorer"
      - **Multi-file investigation**: Reading and cross-referencing 3+ files → "system:explorer"
      - **Answering "how does X work?"**: Any question requiring reading multiple files to understand a feature → "system:explorer"
      - **Dependency/import tracing**: Finding all usages or consumers of a function/module → "system:explorer"
      - **Self-contained code changes**: Implementing a well-defined change across files → "system:simple"
      - **Running and analyzing commands**: Build, test, lint output that could be verbose → "system:simple"

      ### When NOT to Delegate
      - Reading a single, known file path (use your own tools directly)
      - Running a single quick command with predictable short output
      - Tasks requiring back-and-forth conversation (subagents cannot ask follow-up questions)

      ### Parallel Delegation
      When you have multiple independent research tasks, **spawn multiple subagents simultaneously** instead of doing them sequentially.
      Example: investigating auth module AND database schema AND API routes → spawn 3 explorers in parallel.

      ### Choosing the Right Subagent
      - **"system:explorer"** — READ-ONLY. Use for all investigation, research, and understanding tasks. Safer and cheaper.
      - **"system:simple"** — FULL ACCESS. Use only when the task requires file modifications, running builds/tests, or executing commands with side effects.

      ### Intelligence Levels
      - **"fast"** (default): Smaller, cheaper model. Use for exploration, searches, straightforward tasks.
      - **"smart"**: Same large model as you. Use only for tasks requiring complex reasoning or nuanced code changes.

      ### Workflow
      1. Call \`subagents_list\` to see available subagent types (you only need to do this once per session).
      2. Choose the best subagent for your task.
      3. Call \`subagents_run_task\` with a detailed, self-contained task description.
      4. Use the subagent's result to continue your work without having consumed excessive context.
    `;
  }
}
