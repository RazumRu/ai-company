import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export type FinishToolOutput = {
  message: string;
  needsMoreInfo: boolean;
};

export type FinishToolState = {
  done: boolean;
  needsMoreInfo: boolean;
};

export type ToolsMetadata = Record<string, Record<string, unknown>>;

export const FinishToolSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  message: z
    .string()
    .min(1)
    .describe(
      'Description of what was accomplished OR a specific question if more info is needed.',
    ),
  needsMoreInfo: z
    .boolean()
    .default(false)
    .describe(
      'Set to true if you need more information from the user. Include your question in the message field.',
    ),
});
export type FinishToolSchemaType = z.infer<typeof FinishToolSchema>;

@Injectable()
export class FinishTool extends BaseTool<FinishToolSchemaType> {
  public static readonly TOOL_NAME = 'finish' as const;

  public static getStateFromToolsMetadata(
    toolsMetadata: ToolsMetadata | undefined,
  ) {
    const raw = toolsMetadata?.[FinishTool.TOOL_NAME];

    return raw;
  }

  public static setState(state: FinishToolState): ToolsMetadata {
    return { [FinishTool.TOOL_NAME]: state };
  }

  public static clearState(): ToolsMetadata {
    return FinishTool.setState({ done: false, needsMoreInfo: false });
  }

  public name = 'finish';
  public description =
    'End your work by signaling completion or requesting required missing input. Call this tool ONLY when you are completely done with all tasks - do not call it alongside other tools.';

  protected override generateTitle(
    args: FinishToolSchemaType,
    _config: Record<PropertyKey, unknown>,
  ): string {
    return args.purpose;
  }

  public getDetailedInstructions(
    _config: Record<PropertyKey, unknown>,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Call ONCE when completely done to end work or request required info. This is the ONLY way to properly end your work. You must ALWAYS end your response by calling the finish tool (never end with a plain message or "assistant" reply).

      ### When to Use
      All tasks complete and have results to report, OR cannot proceed without specific required information. If you are ready to respond to the user (including a simple greeting or one-shot answer), you must call finish instead of sending a normal assistant message.

      ### When NOT to Use
      Don't call mid-work, alongside other tools, or before completing ALL work. Never output your internal reasoning or a plain-text final response without calling finish.

      ### CRITICAL: Output Delivery for Research/Design/Analysis Tasks
      **Your complete detailed output MUST be provided via the tool call mechanism, NOT in the message parameter:**

      - **message parameter**: Brief 1-3 sentence summary only (e.g., "Research complete. Analyzed auth module and designed 3 improvements.")
      - **Detailed output**: Provide in the tool call's additional instructions/metadata (your LLM framework will handle this automatically when you structure your response correctly)

      **WRONG - Do NOT do this:**
      1. Write your full detailed research/design as a normal assistant message
      2. Then call finish with only a summary in the message parameter

      **CORRECT - Do this:**
      1. Use report_status for brief progress updates while working
      2. When complete, call finish with:
         - message: Brief summary (1-3 sentences)
         - Your framework will capture your full reasoning/output in the tool call metadata

      For research/design tasks, structure your complete detailed output with:
      - High-level checklist (3-7 bullets)
      - Detailed findings/analysis section
      - Technical specifications
      - Implementation steps
      - Acceptance criteria
      - Key files identified
      - Assumptions and follow-ups

      ### Best Practices
      Prefer completion over asking (use defaults/assumptions). If asking, be specific about what's needed with examples. Set \`needsMoreInfo: true\` only when information is strictly required and cannot be reasonably assumed.

      ### Workflow
      1. Call tools → 2. See results → 3. Call more tools if needed → 4. Call finish ONCE when done (not alongside other tools)

      ### Examples
      **Simple completion:**
      \`\`\`json
      {"purpose": "Report completion", "message": "Successfully implemented user auth endpoint with login, JWT validation, and tests.", "needsMoreInfo": false}
      \`\`\`

      **Research/design completion (brief summary in message):**
      \`\`\`json
      {"purpose": "Report research completion", "message": "Research complete. Analyzed authentication flow and designed 3 improvements with implementation steps.", "needsMoreInfo": false}
      \`\`\`
      Note: Your detailed research output will be captured automatically in the tool call metadata, not in the message field.

      **Simple response:**
      \`\`\`json
      {"purpose": "Respond to greeting", "message": "Hi! How can I help?", "needsMoreInfo": false}
      \`\`\`

      **Requesting info:**
      \`\`\`json
      {"purpose": "Request required info", "message": "Need the production API key to proceed. Please provide it.", "needsMoreInfo": true}
      \`\`\`

      **WRONG - calling alongside other tools:**
      \`\`\`
      [files_read(...), files_write(...), finish(...)]  ❌
      \`\`\`

      **CORRECT - call tools, then finish separately:**
      \`\`\`
      Turn 1: [files_read(...), files_write(...)]
      Turn 2: [finish(...)]  ✓
      \`\`\`
    `;
  }

  public get schema() {
    return FinishToolSchema;
  }

  public invoke(
    args: FinishToolSchemaType,
    _config: Record<PropertyKey, unknown>,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
    _toolMetadata?: unknown,
  ): ToolInvokeResult<FinishToolOutput> {
    const title = this.generateTitle?.(args, _config);

    const needsMoreInfo = Boolean(args.needsMoreInfo);
    const stateChange: FinishToolState = {
      done: !needsMoreInfo,
      needsMoreInfo,
    };

    return {
      output: {
        message: args.message,
        needsMoreInfo,
      },
      messageMetadata: { __title: title },
      stateChange,
    };
  }
}
