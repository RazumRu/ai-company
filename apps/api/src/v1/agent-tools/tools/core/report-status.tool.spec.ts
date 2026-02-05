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

  it('should mark tool message metadata with __hideForLlm and __createdAt', () => {
    const tool = new ReportStatusTool();
    const beforeInvoke = new Date();

    const result = tool.invoke(
      { message: 'Processing your request...' },
      {},
      {} as never,
    );

    const afterInvoke = new Date();

    expect(result.messageMetadata?.__hideForLlm).toBe(true);
    expect(result.messageMetadata?.__createdAt).toBeDefined();

    // Verify timestamp is within the invocation window
    const createdAt = new Date(result.messageMetadata?.__createdAt as string);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeInvoke.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(afterInvoke.getTime());
  });

  it('should create AI message with report content, __isReportingMessage flag, and __createdAt', () => {
    const tool = new ReportStatusTool();
    const reportMessage = 'Processing your request...';
    const beforeInvoke = new Date();

    const result = tool.invoke({ message: reportMessage }, {}, {} as never);

    const afterInvoke = new Date();

    expect(result.additionalMessages).toHaveLength(1);

    const aiMessage = result.additionalMessages?.[0] as AIMessage;
    expect(aiMessage).toBeInstanceOf(AIMessage);
    expect(aiMessage.content).toBe(reportMessage);
    expect(aiMessage.additional_kwargs).toMatchObject({
      __isReportingMessage: true,
      __hideForLlm: true,
    });

    // Verify __createdAt is set at invocation time
    const createdAt = aiMessage.additional_kwargs?.__createdAt as string;
    expect(createdAt).toBeDefined();
    const createdAtDate = new Date(createdAt);
    expect(createdAtDate.getTime()).toBeGreaterThanOrEqual(
      beforeInvoke.getTime(),
    );
    expect(createdAtDate.getTime()).toBeLessThanOrEqual(afterInvoke.getTime());
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

      // Tool message should be hidden (via messageMetadata)
      expect(result.messageMetadata?.__hideForLlm).toBe(true);

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

    it('should prevent duplicate reporting messages scenario', () => {
      const tool = new ReportStatusTool();

      const result = tool.invoke(
        {
          message:
            "I'm starting on your request to search for knowledge-related files in the repository.",
        },
        {},
        {} as never,
      );

      // This is the fix for the reported issue:
      // The tool message (with {reported: true}) should be hidden
      expect(result.messageMetadata?.__hideForLlm).toBe(true);

      // Only the AI message with __isReportingMessage should be visible to users
      const aiMessage = result.additionalMessages?.[0] as AIMessage;
      expect(aiMessage.additional_kwargs?.__isReportingMessage).toBe(true);

      // The AI message should also be hidden from the LLM to avoid confusion
      expect(aiMessage.additional_kwargs?.__hideForLlm).toBe(true);
    });

    it('should capture timestamp at invocation time for correct ordering in parallel execution', () => {
      const tool = new ReportStatusTool();
      const beforeInvoke = new Date();

      const result = tool.invoke(
        { message: 'Starting work...' },
        {},
        {} as never,
      );

      // Both the tool message metadata and the AI message should have __createdAt
      // set at invocation time (before Promise.all completes for parallel tools)
      const toolMsgCreatedAt = result.messageMetadata?.__createdAt as string;
      const aiMsgCreatedAt = (result.additionalMessages?.[0] as AIMessage)
        .additional_kwargs?.__createdAt as string;

      expect(toolMsgCreatedAt).toBeDefined();
      expect(aiMsgCreatedAt).toBeDefined();

      // Both should have the same timestamp (captured at the same moment)
      expect(toolMsgCreatedAt).toBe(aiMsgCreatedAt);

      // The timestamp should be from invocation time
      const createdAt = new Date(toolMsgCreatedAt);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeInvoke.getTime(),
      );
    });
  });
});
