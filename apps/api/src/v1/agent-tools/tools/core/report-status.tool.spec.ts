import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';

import { ReportStatusTool } from './report-status.tool';

describe('ReportStatusTool', () => {
  it('should return output with reported: true', () => {
    const tool = new ReportStatusTool();

    const result = tool.invoke(
      { message: 'Processing your request...' },
      {},
      {} as never,
    );

    expect(result.output).toEqual({ reported: true });
  });

  it('should NOT hide tool message from LLM to prevent parallel execution issues', () => {
    const tool = new ReportStatusTool();

    const result = tool.invoke(
      { message: 'Processing your request...' },
      {},
      {} as never,
    );

    // IMPORTANT: The ToolMessage must NOT be hidden from the LLM.
    // When report_status is called in parallel with other tools, hiding the ToolMessage
    // causes filterMessagesForLlm() to filter out the AIMessage that called all tools
    // (because not all tool calls have visible results), which orphans the other tools'
    // results and causes the agent to loop.
    expect(result.messageMetadata?.__hideForLlm).toBeUndefined();
  });

  it('should create AI message with report content and __isReportingMessage flag', () => {
    const tool = new ReportStatusTool();
    const reportMessage = 'Processing your request...';

    const result = tool.invoke({ message: reportMessage }, {}, {} as never);

    expect(result.additionalMessages).toHaveLength(1);

    const aiMessage = result.additionalMessages?.[0] as AIMessage;
    expect(aiMessage).toBeInstanceOf(AIMessage);
    expect(aiMessage.content).toBe(reportMessage);
    expect(aiMessage.additional_kwargs).toMatchObject({
      __isReportingMessage: true,
      __hideForLlm: true,
    });
  });

  it('should hide AI message from LLM using markMessageHideForLlm', () => {
    const tool = new ReportStatusTool();

    const result = tool.invoke(
      { message: 'Analyzing the codebase...' },
      {},
      {} as never,
    );

    const aiMessage = result.additionalMessages?.[0] as AIMessage;
    expect(aiMessage.additional_kwargs?.__hideForLlm).toBe(true);
  });

  it('should handle multi-line status messages', () => {
    const tool = new ReportStatusTool();
    const multiLineMessage = `I found the root cause.
Now updating the config and tests.`;

    const result = tool.invoke({ message: multiLineMessage }, {}, {} as never);

    const aiMessage = result.additionalMessages?.[0] as AIMessage;
    expect(aiMessage.content).toBe(multiLineMessage);
  });

  it('should have correct tool name', () => {
    const tool = new ReportStatusTool();
    expect(tool.name).toBe('report_status');
    expect(ReportStatusTool.TOOL_NAME).toBe('report_status');
  });

  it('should have meaningful description', () => {
    const tool = new ReportStatusTool();
    expect(tool.description).toContain('status update');
    expect(tool.description).toContain('user');
  });

  it('should validate schema requires non-empty message', () => {
    const tool = new ReportStatusTool();
    const schema = tool.schema;

    // Valid message
    expect(() => schema.parse({ message: 'Valid message' })).not.toThrow();

    // Empty message should fail
    expect(() => schema.parse({ message: '' })).toThrow();

    // Missing message should fail
    expect(() => schema.parse({})).toThrow();
  });

  describe('integration scenario', () => {
    it('should produce correct message structure for tool executor node', () => {
      const tool = new ReportStatusTool();
      const statusUpdate = "I'm starting the search for files...";

      const result = tool.invoke({ message: statusUpdate }, {}, {} as never);

      // Tool message should NOT be hidden to prevent parallel execution issues
      expect(result.messageMetadata?.__hideForLlm).toBeUndefined();

      // Output for tool message should be minimal
      expect(result.output).toEqual({ reported: true });

      // AI message should contain the actual report
      expect(result.additionalMessages).toHaveLength(1);
      const aiMessage = result.additionalMessages?.[0] as AIMessage;

      // AI message should be marked for reporting
      expect(aiMessage.additional_kwargs?.__isReportingMessage).toBe(true);

      // AI message should be hidden from LLM (to avoid confusion in future turns)
      expect(aiMessage.additional_kwargs?.__hideForLlm).toBe(true);

      // AI message should contain the user-facing status text
      expect(aiMessage.content).toBe(statusUpdate);
    });

    it('should allow parallel execution with other tools without causing loops', () => {
      const tool = new ReportStatusTool();

      const result = tool.invoke(
        {
          message:
            "I'm starting on your request to search for knowledge-related files in the repository.",
        },
        {},
        {} as never,
      );

      // CRITICAL: The tool message must NOT be hidden.
      // When report_status is called in parallel with other tools (e.g., communication_exec),
      // hiding the ToolMessage causes filterMessagesForLlm() to:
      // 1. Exclude the report_status tool_call_id from toolResultIds
      // 2. Filter out the AIMessage that called all tools (because not all calls have visible results)
      // 3. Orphan ALL tool results (including the other tool's result)
      // 4. Cause the LLM to not see any tool execution and retry, creating loops
      expect(result.messageMetadata?.__hideForLlm).toBeUndefined();

      // Only the AI message with __isReportingMessage should be visible to users
      const aiMessage = result.additionalMessages?.[0] as AIMessage;
      expect(aiMessage.additional_kwargs?.__isReportingMessage).toBe(true);

      // The AI message should be hidden from the LLM to avoid confusion
      expect(aiMessage.additional_kwargs?.__hideForLlm).toBe(true);
    });
  });
});
