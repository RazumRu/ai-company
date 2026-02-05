import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';

import type { LitellmService } from '../../../litellm/services/litellm.service';
import { BaseAgentState } from '../../agents.types';
import { ToolExecutorNode } from './tool-executor-node';

describe('ToolExecutorNode', () => {
  let node: ToolExecutorNode;
  let mockTool1: DynamicStructuredTool;
  let mockTool2: DynamicStructuredTool;
  let mockFinishTool: DynamicStructuredTool;
  let mockLitellmService: LitellmService;

  beforeEach(() => {
    mockTool1 = {
      name: 'test-tool-1',
      description: 'Test tool 1',
      invoke: vi.fn(),
    } as unknown as DynamicStructuredTool;

    mockTool2 = {
      name: 'test-tool-2',
      description: 'Test tool 2',
      invoke: vi.fn(),
    } as unknown as DynamicStructuredTool;

    mockFinishTool = {
      name: 'finish',
      description: 'Finish tool',
      invoke: vi.fn(),
    } as unknown as DynamicStructuredTool;

    mockLitellmService = {
      sumTokenUsages: vi.fn().mockReturnValue(null),
    } as unknown as LitellmService;

    node = new ToolExecutorNode(
      [mockTool1, mockTool2, mockFinishTool],
      mockLitellmService,
    );
  });

  describe('constructor', () => {
    it('should initialize with tools', () => {
      expect(node['tools']).toHaveLength(3);
      expect(node['tools']).toContain(mockTool1);
      expect(node['tools']).toContain(mockTool2);
      expect(node['tools']).toContain(mockFinishTool);
    });

    it('should default maxOutputChars to 500000', () => {
      expect(node['maxOutputChars']).toBe(500_000);
    });

    it('should initialize with empty tools array', () => {
      const emptyNode = new ToolExecutorNode([], mockLitellmService);
      expect(emptyNode['tools']).toHaveLength(0);
    });
  });

  describe('invoke', () => {
    let mockState: BaseAgentState;
    let mockConfig: Record<string, unknown>;

    beforeEach(() => {
      mockState = {
        messages: [],
        summary: '',
        toolUsageGuardActivated: false,
        toolsMetadata: {},
        toolUsageGuardActivatedCount: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      };

      mockConfig = {
        configurable: {
          thread_id: 'test-thread',
        },
      };
    });

    it('should execute tool calls from AI message', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test input' },
      };

      const aiMessage = new AIMessage({
        content: 'I will use the tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: 'Tool result 1' });

      const result = await node.invoke(mockState, mockConfig);

      expect(mockTool1.invoke).toHaveBeenCalledWith(
        { input: 'test input' },
        mockConfig,
      );

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items[0]?.content).toBe('Tool result 1');
      expect((result.messages?.items[0] as ToolMessage)?.tool_call_id).toBe(
        'call-1',
      );
    });

    it('should execute multiple tool calls', async () => {
      const toolCall1 = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'input 1' },
      };

      const toolCall2 = {
        id: 'call-2',
        name: 'test-tool-2',
        args: { input: 'input 2' },
      };

      const aiMessage = new AIMessage({
        content: 'I will use multiple tools',
        tool_calls: [toolCall1, toolCall2],
      });

      mockState.messages = [aiMessage];
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: 'Result 1' });
      mockTool2.invoke = vi.fn().mockResolvedValue({ output: 'Result 2' });

      const result = await node.invoke(mockState, mockConfig);

      expect(mockTool1.invoke).toHaveBeenCalledWith(
        { input: 'input 1' },
        mockConfig,
      );
      expect(mockTool2.invoke).toHaveBeenCalledWith(
        { input: 'input 2' },
        mockConfig,
      );

      expect(result.messages?.items).toHaveLength(2);
      expect(result.messages?.items?.[0]?.content).toBe('Result 1');
      expect(result.messages?.items?.[1]?.content).toBe('Result 2');
    });

    it('should handle tool not found error', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'non-existent-tool',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using unknown tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[0]?.content).toContain(
        "Tool 'non-existent-tool' not found",
      );
      expect((result.messages?.items[0] as ToolMessage).tool_call_id).toBe(
        'call-1',
      );
    });

    it('should handle tool execution errors', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool that will fail',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      const mockError = new Error('Tool execution failed');
      mockTool1.invoke = vi.fn().mockRejectedValue(mockError);

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[0]?.content).toContain(
        "Error executing tool 'test-tool-1'",
      );
      expect(result.messages?.items?.[0]?.content).toContain(
        'Tool execution failed',
      );
    });

    it('should return empty messages when no tool calls', async () => {
      const aiMessage = new AIMessage({
        content: 'No tools used',
        tool_calls: [],
      });

      mockState.messages = [aiMessage];

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(0);
    });

    it('should handle undefined tool calls', async () => {
      const aiMessage = new AIMessage({
        content: 'No tools used',
        // tool_calls is undefined
      });

      mockState.messages = [aiMessage];

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(0);
    });

    it('should handle non-AI messages gracefully', async () => {
      const humanMessage = new HumanMessage('Hello');
      mockState.messages = [humanMessage];

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(0);
    });

    it('should handle mixed message types', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const humanMessage = new HumanMessage('Hello');
      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [humanMessage, aiMessage];
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: 'Tool result' });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe('Tool result');
    });

    it('should serialize tool results correctly', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      // Return complex object that needs serialization
      const complexResult = {
        data: { nested: 'value' },
        array: [1, 2, 3],
        boolean: true,
      };
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: complexResult });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe(
        stringifyYaml(complexResult).trimEnd(),
      );
    });

    it('should convert JSON string tool results to YAML', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      const jsonString = JSON.stringify({
        data: { nested: 'value' },
        array: [1, 2, 3],
        boolean: true,
      });
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: jsonString });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe(
        stringifyYaml(JSON.parse(jsonString)).trimEnd(),
      );
    });

    it('should trim tool output that exceeds maxOutputChars and append suffix', async () => {
      const limitedNode = new ToolExecutorNode(
        [mockTool1],
        mockLitellmService,
        {
          maxOutputChars: 10,
        },
      );

      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      const longOutput = 'a'.repeat(12);
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: longOutput });

      const result = await limitedNode.invoke(mockState, mockConfig);
      const expectedSuffix = '\n\n[output trimmed to 10 characters from 12]';

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe(
        `${longOutput.slice(0, 10)}${expectedSuffix}`,
      );
    });

    it('should handle string tool results', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: 'Simple string result',
      });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe('Simple string result');
    });

    it('should pass correct config to tools', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      const customConfig = {
        configurable: {
          thread_id: 'custom-thread',
          custom_param: 'value',
        },
        recursionLimit: 100,
      };

      mockState.messages = [aiMessage];
      mockTool1.invoke = vi.fn().mockResolvedValue({ output: 'result' });

      await node.invoke(mockState, customConfig);

      expect(mockTool1.invoke).toHaveBeenCalledWith(
        { input: 'test' },
        {
          configurable: customConfig.configurable,
        },
      );
    });

    it('should persist finish stateChange', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'finish',
        args: {
          purpose: 'Completing the task',
          message: 'Task completed successfully',
        },
      };

      const aiMessage = new AIMessage({
        content: 'Finishing task',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      mockFinishTool.invoke = vi.fn().mockResolvedValue({
        output: {
          message: 'Task completed successfully',
          needsMoreInfo: false,
        },
        stateChange: { done: true, needsMoreInfo: false },
      });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.toolsMetadata).toEqual({
        finish: { done: true, needsMoreInfo: false },
      });
      expect(result.messages?.items?.[0]?.content).toBe(
        stringifyYaml({
          message: 'Task completed successfully',
          needsMoreInfo: false,
        }).trimEnd(),
      );
    });

    it('should handle finish tool stateChange with needsMoreInfo and mirror it', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'finish',
        args: {
          purpose: 'Asking for more information',
          message: 'What is the target environment?',
          needsMoreInfo: true,
        },
      };

      const aiMessage = new AIMessage({
        content: 'Need more info',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];
      mockFinishTool.invoke = vi.fn().mockResolvedValue({
        output: {
          message: 'What is the target environment?',
          needsMoreInfo: true,
        },
        stateChange: { done: false, needsMoreInfo: true },
      });

      const result = await node.invoke(mockState, mockConfig);

      expect(result.toolsMetadata).toEqual({
        finish: { done: false, needsMoreInfo: true },
      });
      expect(result.messages?.items?.[0]?.content).toBe(
        stringifyYaml({
          message: 'What is the target environment?',
          needsMoreInfo: true,
        }).trimEnd(),
      );
    });

    it('should capture and aggregate tool request usage', async () => {
      const toolCall1 = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'input 1' },
      };

      const toolCall2 = {
        id: 'call-2',
        name: 'test-tool-2',
        args: { input: 'input 2' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tools with usage tracking',
        tool_calls: [toolCall1, toolCall2],
      });

      mockState.messages = [aiMessage];

      // Mock tool 1 returns usage
      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: 'Result 1',
        toolRequestUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          totalPrice: 0.001,
        },
      });

      // Mock tool 2 returns usage
      mockTool2.invoke = vi.fn().mockResolvedValue({
        output: 'Result 2',
        toolRequestUsage: {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          totalPrice: 0.002,
        },
      });

      // Mock litellmService.sumTokenUsages to aggregate
      mockLitellmService.sumTokenUsages = vi.fn().mockReturnValue({
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        totalPrice: 0.003,
      });

      const result = await node.invoke(mockState, mockConfig);

      // Verify sumTokenUsages was called with both usages
      expect(mockLitellmService.sumTokenUsages).toHaveBeenCalledWith([
        {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          totalPrice: 0.001,
        },
        {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          totalPrice: 0.002,
        },
      ]);

      // Verify aggregated usage is in the state change
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.totalTokens).toBe(450);
      expect(result.totalPrice).toBe(0.003);

      // Verify usage is attached to tool messages
      expect(result.messages?.items).toHaveLength(2);
      expect(
        result.messages?.items?.[0]?.additional_kwargs?.__requestUsage,
      ).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.001,
      });
      expect(
        result.messages?.items?.[1]?.additional_kwargs?.__requestUsage,
      ).toEqual({
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        totalPrice: 0.002,
      });
    });

    it('should handle tools without usage tracking', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      // Tool returns no usage
      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: 'Result without usage',
      });

      const result = await node.invoke(mockState, mockConfig);

      // Verify no usage fields in state change
      expect(result.inputTokens).toBeUndefined();
      expect(result.outputTokens).toBeUndefined();
      expect(result.totalTokens).toBeUndefined();

      // Verify no usage attached to message
      expect(
        result.messages?.items?.[0]?.additional_kwargs?.__requestUsage,
      ).toBeUndefined();
    });

    it('should interleave additional messages immediately after their corresponding tool result', async () => {
      const toolCall1 = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test1' },
      };

      const toolCall2 = {
        id: 'call-2',
        name: 'test-tool-2',
        args: { input: 'test2' },
      };

      const aiMessage = new AIMessage({
        content: 'Using multiple tools',
        tool_calls: [toolCall1, toolCall2],
      });

      mockState.messages = [aiMessage];

      // Tool 1 returns a result WITH additional messages (e.g., from report_status)
      const additionalMsg1 = new AIMessage({
        content: 'Tool 1 status report',
        additional_kwargs: { __isReportingMessage: true },
      });

      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: 'Result from tool 1',
        additionalMessages: [additionalMsg1],
      });

      // Tool 2 returns a result WITHOUT additional messages
      mockTool2.invoke = vi.fn().mockResolvedValue({
        output: 'Result from tool 2',
      });

      const result = await node.invoke(mockState, mockConfig);

      // Should have 3 messages: tool1 result, additional message, tool2 result
      expect(result.messages?.items).toHaveLength(3);

      // First message should be tool 1 result
      expect(result.messages?.items?.[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[0]?.content).toBe('Result from tool 1');

      // Second message should be the additional message from tool 1
      expect(result.messages?.items?.[1]).toBeInstanceOf(AIMessage);
      expect(result.messages?.items?.[1]?.content).toBe('Tool 1 status report');
      expect(
        result.messages?.items?.[1]?.additional_kwargs?.__isReportingMessage,
      ).toBe(true);

      // Third message should be tool 2 result
      expect(result.messages?.items?.[2]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[2]?.content).toBe('Result from tool 2');
    });

    it('should handle multiple additional messages from a single tool', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { input: 'test' },
      };

      const aiMessage = new AIMessage({
        content: 'Using tool',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      const additionalMsg1 = new AIMessage({
        content: 'First status update',
        additional_kwargs: { __isReportingMessage: true },
      });

      const additionalMsg2 = new AIMessage({
        content: 'Second status update',
        additional_kwargs: { __isReportingMessage: true },
      });

      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: 'Tool result',
        additionalMessages: [additionalMsg1, additionalMsg2],
      });

      const result = await node.invoke(mockState, mockConfig);

      // Should have 3 messages: tool result + 2 additional messages
      expect(result.messages?.items).toHaveLength(3);

      // First should be tool result
      expect(result.messages?.items?.[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[0]?.content).toBe('Tool result');

      // Second should be first additional message
      expect(result.messages?.items?.[1]).toBeInstanceOf(AIMessage);
      expect(result.messages?.items?.[1]?.content).toBe('First status update');

      // Third should be second additional message
      expect(result.messages?.items?.[2]).toBeInstanceOf(AIMessage);
      expect(result.messages?.items?.[2]?.content).toBe('Second status update');
    });

    it('should mark tool message with __hideForLlm when messageMetadata specifies it', async () => {
      const toolCall = {
        id: 'call-1',
        name: 'test-tool-1',
        args: { message: 'Status update' },
      };

      const aiMessage = new AIMessage({
        content: 'Reporting status',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      // Tool returns result with messageMetadata.__hideForLlm (like report_status tool)
      const additionalMsg = new AIMessage({
        content: 'Status update for user',
        additional_kwargs: {
          __isReportingMessage: true,
          __hideForLlm: true,
        },
      });

      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: { reported: true },
        messageMetadata: {
          __hideForLlm: true, // This should hide the tool message
        },
        additionalMessages: [additionalMsg],
      });

      const result = await node.invoke(mockState, mockConfig);

      // Should have 2 messages: tool result + additional message
      expect(result.messages?.items).toHaveLength(2);

      // Tool message should have __hideForLlm from messageMetadata
      expect(result.messages?.items?.[0]).toBeInstanceOf(ToolMessage);
      expect(result.messages?.items?.[0]?.additional_kwargs?.__hideForLlm).toBe(
        true,
      );

      // Additional AI message should have __isReportingMessage and __hideForLlm
      expect(result.messages?.items?.[1]).toBeInstanceOf(AIMessage);
      expect(
        result.messages?.items?.[1]?.additional_kwargs?.__isReportingMessage,
      ).toBe(true);
      expect(result.messages?.items?.[1]?.additional_kwargs?.__hideForLlm).toBe(
        true,
      );
    });

    it('should properly handle report_status tool pattern to prevent duplicate reporting', async () => {
      // This test verifies the fix for the duplicate report_status messages issue
      const toolCall = {
        id: 'call-1',
        name: 'report_status',
        args: {
          message:
            "I'm starting on your request to search for knowledge-related files.",
        },
      };

      const aiMessage = new AIMessage({
        content: 'Reporting progress',
        tool_calls: [toolCall],
      });

      mockState.messages = [aiMessage];

      // Simulate report_status tool behavior
      const reportMessage = new AIMessage({
        content:
          "I'm starting on your request to search for knowledge-related files.",
        additional_kwargs: {
          __isReportingMessage: true,
          __hideForLlm: true,
        },
      });

      mockTool1.name = 'report_status';
      mockTool1.invoke = vi.fn().mockResolvedValue({
        output: { reported: true },
        messageMetadata: {
          __hideForLlm: true, // Tool message should be hidden
        },
        additionalMessages: [reportMessage],
      });

      const result = await node.invoke(mockState, mockConfig);

      // Should have 2 messages: hidden tool message + visible AI message
      expect(result.messages?.items).toHaveLength(2);

      // First message: tool message with {reported: true}, marked as hidden
      const toolMessage = result.messages?.items?.[0] as ToolMessage;
      expect(toolMessage).toBeInstanceOf(ToolMessage);
      expect(toolMessage.name).toBe('report_status');
      expect(toolMessage.additional_kwargs?.__hideForLlm).toBe(true);

      // Second message: AI message with actual report content
      const aiReportMessage = result.messages?.items?.[1] as AIMessage;
      expect(aiReportMessage).toBeInstanceOf(AIMessage);
      expect(aiReportMessage.content).toBe(
        "I'm starting on your request to search for knowledge-related files.",
      );
      expect(aiReportMessage.additional_kwargs?.__isReportingMessage).toBe(
        true,
      );
      expect(aiReportMessage.additional_kwargs?.__hideForLlm).toBe(true);

      // The key assertion: tool message should be hidden from both UI and LLM
      // Only the AI message with __isReportingMessage should be displayed to users
      expect(toolMessage.additional_kwargs?.__hideForLlm).toBe(true);
    });
  });
});
