import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../agents/agents.types';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';
import type { ToolsMetadata } from './finish.tool';

export type WaitForToolOutput = {
  message: string;
  scheduledResumeAt: string;
};

export type WaitForToolState = {
  done: boolean;
  waiting: boolean;
  durationSeconds: number;
  checkPrompt: string;
  reason: string;
};

export const WaitForToolSchema = z.object({
  durationSeconds: z
    .number()
    .int()
    .min(1)
    .max(86400)
    .describe('Duration to wait in seconds before resuming (1 to 86400).'),
  checkPrompt: z
    .string()
    .min(1)
    .describe(
      'The message to inject when the thread resumes. Should instruct the agent on what to check or do next.',
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      'Human-readable explanation of why the agent is waiting. Shown to users in the UI.',
    ),
});
export type WaitForToolSchemaType = z.infer<typeof WaitForToolSchema>;

@Injectable()
export class WaitForTool extends BaseTool<WaitForToolSchemaType> {
  public static readonly TOOL_NAME = 'wait_for' as const;

  public static getStateFromToolsMetadata(
    toolsMetadata: ToolsMetadata | undefined,
  ) {
    return toolsMetadata?.[WaitForTool.TOOL_NAME] as
      | WaitForToolState
      | undefined;
  }

  public static setState(state: WaitForToolState): ToolsMetadata {
    return { [WaitForTool.TOOL_NAME]: state };
  }

  public static clearState(): ToolsMetadata {
    return {
      [WaitForTool.TOOL_NAME]: {
        done: false,
        waiting: false,
        durationSeconds: 0,
        checkPrompt: '',
        reason: '',
      },
    };
  }

  public name = WaitForTool.TOOL_NAME;
  public description =
    'Schedule a delayed resumption of the current thread. Use this tool when you need to wait for an external process to complete before checking its result. This is ideal for CI pipelines, deployments, PR reviews, or any long-running external operation where polling would waste tokens. This tool ends your current turn (like finish) and must be called alone, not alongside other tools.';

  protected override generateTitle(
    args: WaitForToolSchemaType,
    _config: Record<PropertyKey, unknown>,
  ): string {
    return args.reason;
  }

  public getDetailedInstructions(
    _config: Record<PropertyKey, unknown>,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Schedule a delayed resumption of the current thread. Use this when you need to wait
      for an external process to complete (CI pipeline, deployment, PR review, etc.) before
      checking the result.

      ### When to Use
      - You created a pull request and need to wait for CI checks to complete
      - You triggered a deployment and need to wait for it to finish
      - You started a long-running external process and need to check its status later
      - Any situation where polling would waste tokens and time

      ### When NOT to Use
      - Your work is complete -- use finish instead
      - You need information from the user -- use finish with needsMoreInfo instead
      - The result is available immediately -- just check it now

      ### Parameters
      - durationSeconds: How long to wait (1-86400 seconds / max 24 hours)
      - checkPrompt: What you want to do when you wake up (e.g., "Check the status of PR #42")
      - reason: Why you are waiting (shown to the user)

      ### Chaining Waits
      After resuming, if the condition is not yet met, you can call wait_for again
      to schedule another check. This allows monitoring over extended periods.

      ### Important
      This tool ends your current turn (like finish). Do not call other tools after it.
      Call it alone, not alongside other tools.
    `;
  }

  public get schema() {
    return WaitForToolSchema;
  }

  public invoke(
    args: WaitForToolSchemaType,
    _config: Record<PropertyKey, unknown>,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    _toolMetadata?: unknown,
  ): ToolInvokeResult<WaitForToolOutput> {
    const title = this.generateTitle?.(args, _config);

    const stateChange: WaitForToolState = {
      done: true,
      waiting: true,
      durationSeconds: args.durationSeconds,
      checkPrompt: args.checkPrompt,
      reason: args.reason,
    };

    return {
      output: {
        message: `Scheduled resume in ${args.durationSeconds} seconds. Reason: ${args.reason}`,
        scheduledResumeAt: new Date(
          Date.now() + args.durationSeconds * 1000,
        ).toISOString(),
      },
      messageMetadata: { __title: title },
      stateChange,
    };
  }
}
