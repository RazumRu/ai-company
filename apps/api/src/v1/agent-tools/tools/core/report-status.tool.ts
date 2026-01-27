import { AIMessage } from '@langchain/core/messages';
import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { markMessageHideForLlm } from '../../../agents/agents.utils';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export const ReportStatusToolSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe(
      'Status update to share with the user (informative only; no questions).',
    ),
});
export type ReportStatusToolSchemaType = z.infer<typeof ReportStatusToolSchema>;

type ReportStatusToolOutput = {
  reported: boolean;
};

@Injectable()
export class ReportStatusTool extends BaseTool<ReportStatusToolSchemaType> {
  public static readonly TOOL_NAME = 'report_status' as const;

  public name = ReportStatusTool.TOOL_NAME;
  public description =
    'Report a mid-work status update to the user and continue working.';

  public getDetailedInstructions(
    _config: Record<PropertyKey, unknown>,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Report a status update to the user without ending your work. This tool appends a new AI message flagged with \`__isReportingMessage\` so the UI can treat it as a mid-work update.

      ### When to Use
      Use ONLY when you are already executing a multi-step task (research, long analysis, multi-file edits, running checks, etc.) and you want to share progress while continuing work. The update must be informative only and must not include questions. Use sparingly: only for meaningful milestones.

      ### When NOT to Use
      Do NOT use for simple user questions or normal assistant replies. If you can answer directly in one response, just answer normally and do not call this tool.
      If you need user input, call \`finish\` with \`needsMoreInfo: true\`. If your work is done, call \`finish\` with \`needsMoreInfo: false\`.

      ### Important
      If you want to report status (without questions) and continue working, do NOT send a normal assistant message. Call \`report_status\` instead.

      ### Example
      \`\`\`json
      {"message": "I found the root cause and I’m updating the config + tests next."}
      \`\`\`
    `;
  }

  public get schema() {
    return ReportStatusToolSchema;
  }

  public invoke(
    args: ReportStatusToolSchemaType,
    _config: Record<PropertyKey, unknown>,
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): ToolInvokeResult<ReportStatusToolOutput> {
    const reportMessage = new AIMessage({
      content: args.message,
      additional_kwargs: { __isReportingMessage: true },
    });

    return {
      output: { reported: true },
      additionalMessages: [markMessageHideForLlm(reportMessage)],
    };
  }
}
