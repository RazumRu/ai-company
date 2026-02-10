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
      'Your COMPLETE final output to the user. For research/design tasks, include ALL findings, analysis, recommendations, and implementation details — not just a summary. For simple tasks, a brief description of what was accomplished. If needsMoreInfo is true, include your specific question.',
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
    'Signal that all work is complete or request missing information from the user. This is the ONLY way to properly end your turn — you must always call it when done instead of sending a plain assistant message. It must be the sole tool call in its turn; never call it alongside other tools. Set needsMoreInfo to true when you cannot proceed without specific user input, otherwise set it to false for normal completion.';

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

      ### CRITICAL: All Output Goes in the message Field
      The \`message\` field is the ONLY thing the user sees from the finish tool. You MUST put your COMPLETE output there — not just a summary.

      **WRONG — Do NOT do this:**
      1. Write your full detailed research/design as a normal assistant message
      2. Then call finish with only a brief summary in the message field
      ⚠️ Normal assistant messages before finish are NOT reliably shown to the user. Only the finish message is guaranteed to be displayed.

      **CORRECT — Do this:**
      1. Use \`report_status\` for brief progress updates while working
      2. When complete, call finish and put your ENTIRE output in the \`message\` field

      **For research/design/analysis tasks, the \`message\` field must contain:**
      - High-level summary (2-3 sentences)
      - Detailed findings/analysis
      - Technical specifications or design decisions
      - Implementation steps or recommendations
      - Acceptance criteria
      - Key files identified
      - Assumptions and follow-ups

      **For simple tasks**, a brief description of what was accomplished is sufficient.

      ### Best Practices
      Prefer completion over asking (use defaults/assumptions). If asking, be specific about what's needed with examples. Set \`needsMoreInfo: true\` only when information is strictly required and cannot be reasonably assumed.

      ### Workflow
      1. Call tools → 2. See results → 3. Call more tools if needed → 4. Call finish ONCE when done (not alongside other tools)

      ### Examples
      **Simple completion:**
      \`\`\`json
      {"purpose": "Report completion", "message": "Successfully implemented user auth endpoint with login, JWT validation, and tests.", "needsMoreInfo": false}
      \`\`\`

      **Research/design completion (full output in message):**
      \`\`\`json
      {"purpose": "Report research completion", "message": "## Summary\\nAnalyzed authentication flow and identified 3 improvements.\\n\\n## Findings\\n1. Token refresh logic has a race condition in concurrent requests...\\n2. Session expiry check is missing from the middleware...\\n3. Password hashing uses outdated bcrypt rounds...\\n\\n## Recommendations\\n- Fix race condition by adding a token refresh mutex\\n- Add session validation middleware to all protected routes\\n- Upgrade bcrypt rounds from 10 to 12\\n\\n## Key Files\\n- src/auth/token.service.ts (lines 45-67)\\n- src/middleware/session.ts\\n- src/auth/password.utils.ts", "needsMoreInfo": false}
      \`\`\`

      **Simple response:**
      \`\`\`json
      {"purpose": "Respond to greeting", "message": "Hi! How can I help?", "needsMoreInfo": false}
      \`\`\`

      **Requesting info:**
      \`\`\`json
      {"purpose": "Request required info", "message": "Need the production API key to proceed. Please provide it.", "needsMoreInfo": true}
      \`\`\`

      **WRONG — calling alongside other tools:**
      \`\`\`
      [files_read(...), files_write(...), finish(...)]  ❌
      \`\`\`

      **CORRECT — call tools, then finish separately:**
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
