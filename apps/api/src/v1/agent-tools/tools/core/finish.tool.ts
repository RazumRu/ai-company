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
  public description = `Signal task completion or request strictly necessary info. Always call this tool to end your turn. Set needsMoreInfo=false when done. Set needsMoreInfo=true only if a specific required input is missing and you cannot proceed; do not ask open-ended or speculative questions. If you can proceed using context or reasonable defaults, do so and state assumptions in message. If you must ask, send one concise, structured request listing the exact fields and acceptable formats. This is the only way to end your response.`;

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
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      The finish tool is the ONLY way to properly end your turn. Every response must conclude with a finish call, either signaling completion or requesting essential information.

      ### When to Use
      - **ALWAYS** - every turn must end with this tool
      - When task is complete and you have results to report
      - When you cannot proceed without specific required information
      - After making all intended changes for this turn

      ### When NOT to Use
      - Never skip this tool - it must be called at the end of every turn
      - Don't call it in the middle of work - finish your current operations first

      ${parameterDocs}

      ### \`message\` example

      **For completion (needsMoreInfo: false):**
      \`\`\`json
      {
        "message": "Successfully implemented the user registration endpoint. Changes made:\\n- Created POST /api/users/register\\n- Added email validation\\n- Integrated with database\\n- Added unit tests\\n\\nThe endpoint is ready for testing.",
        "needsMoreInfo": false
      }
      \`\`\`

      **For requesting info (needsMoreInfo: true):**
      \`\`\`json
      {
        "message": "To proceed, I need the following:\\n\\n1. Repository URL (format: owner/repo or full GitHub URL)\\n2. Target branch name (default: main if not specified)\\n\\nPlease provide these details.",
        "needsMoreInfo": true
      }
      \`\`\`

      ### Best Practices

      **1. Always prefer completion over asking:**
      Try to complete the task using context, defaults, or reasonable assumptions.
      \`\`\`json
      // Good: Make assumptions and proceed
      {
        "message": "Completed the task. I assumed the default database port 5432 since it wasn't specified.",
        "needsMoreInfo": false
      }

      // Avoid: Asking when you can assume
      {
        "message": "What database port should I use?",
        "needsMoreInfo": true
      }
      \`\`\`

      **2. If you must ask, be specific:**
      \`\`\`json
      // Good: Specific, actionable question
      {
        "message": "To create the API key, I need:\\n\\n• Service name (e.g., 'payment-service')\\n• Permission level: 'read', 'write', or 'admin'\\n\\nPlease provide both values.",
        "needsMoreInfo": true
      }

      // Bad: Vague question
      {
        "message": "What should I do next?",
        "needsMoreInfo": true
      }
      \`\`\`

      **3. Summarize accomplishments clearly:**
      \`\`\`json
      {
        "message": "### Completed Tasks\\n\\n1. ✅ Created new component at /src/components/Button.tsx\\n2. ✅ Added unit tests\\n3. ✅ Updated exports in index.ts\\n\\n### Files Modified\\n- src/components/Button.tsx (created)\\n- src/components/Button.test.tsx (created)\\n- src/components/index.ts (updated)\\n\\nThe component is ready for use.",
        "needsMoreInfo": false
      }
      \`\`\`

      **4. State assumptions when made:**
      \`\`\`json
      {
        "message": "Completed the database migration.\\n\\n**Assumptions made:**\\n- Used PostgreSQL syntax (detected from existing migrations)\\n- Set default value to current timestamp for createdAt\\n- Made email field unique based on the model definition\\n\\nPlease review the migration before running it.",
        "needsMoreInfo": false
      }
      \`\`\`

      ### Question Guidelines
      Only ask when ALL of these are true:
      1. The information is strictly required to proceed
      2. You cannot make a reasonable assumption
      3. Getting it wrong would be irreversible or very problematic

      Ask only ONE structured question at a time:
      \`\`\`json
      {
        "message": "I need the AWS region for deployment. Please specify one of:\\n- us-east-1\\n- us-west-2\\n- eu-west-1\\n- ap-southeast-1",
        "needsMoreInfo": true
      }
      \`\`\`

      ### Output Format
      Returns an object with \`message\` and \`needsMoreInfo\`. The agent runtime derives completion flags from tool state.

      ### Error Pattern
      NEVER end without calling finish:
      \`\`\`
      // WRONG: Ending without finish
      Made the changes you requested.

      // CORRECT: Always use finish tool
      {"purpose": "Report completion", "message": "Made the changes you requested.", "needsMoreInfo": false}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FinishToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
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
