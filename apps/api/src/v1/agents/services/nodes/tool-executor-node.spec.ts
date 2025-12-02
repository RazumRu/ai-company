import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FinishToolResponse } from '../../../agent-tools/tools/core/finish.tool';
import { BaseAgentState } from '../../agents.types';
import { ToolExecutorNode } from './tool-executor-node';

describe('ToolExecutorNode', () => {
  let node: ToolExecutorNode;
  let mockTool1: DynamicStructuredTool;
  let mockTool2: DynamicStructuredTool;
  let mockFinishTool: DynamicStructuredTool;

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

    node = new ToolExecutorNode([mockTool1, mockTool2, mockFinishTool]);
  });

  describe('constructor', () => {
    it('should initialize with tools', () => {
      expect(node['tools']).toHaveLength(3);
      expect(node['tools']).toContain(mockTool1);
      expect(node['tools']).toContain(mockTool2);
      expect(node['tools']).toContain(mockFinishTool);
    });

    it('should initialize with empty tools array', () => {
      const emptyNode = new ToolExecutorNode([]);
      expect(emptyNode['tools']).toHaveLength(0);
    });
  });

  describe('invoke', () => {
    let mockState: BaseAgentState;
    let mockConfig: Record<string, unknown>;

    beforeEach(() => {
      mockState = {
        messages: [],
        toolUsageGuardActivated: false,
        summary: '',
        done: false,
        needsMoreInfo: false,
        toolUsageGuardActivatedCount: 0,
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
      mockTool1.invoke = vi.fn().mockResolvedValue('Tool result 1');

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
      mockTool1.invoke = vi.fn().mockResolvedValue('Result 1');
      mockTool2.invoke = vi.fn().mockResolvedValue('Result 2');

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
      mockTool1.invoke = vi.fn().mockResolvedValue('Tool result');

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
      mockTool1.invoke = vi.fn().mockResolvedValue(complexResult);

      const result = await node.invoke(mockState, mockConfig);

      expect(result.messages?.items).toHaveLength(1);
      expect(result.messages?.items?.[0]?.content).toBe(
        JSON.stringify(complexResult),
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
      mockTool1.invoke = vi.fn().mockResolvedValue('Simple string result');

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
      mockTool1.invoke = vi.fn().mockResolvedValue('result');

      await node.invoke(mockState, customConfig);

      expect(mockTool1.invoke).toHaveBeenCalledWith(
        { input: 'test' },
        {
          configurable: customConfig.configurable,
        },
      );
    });

    it('should handle FinishToolResponse and set done to true', async () => {
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
      mockState.done = false;
      mockFinishTool.invoke = vi
        .fn()
        .mockResolvedValue(
          new FinishToolResponse('Task completed successfully', false),
        );

      const result = await node.invoke(mockState, mockConfig);

      expect(result.done).toBe(true);
      expect(result.messages?.items?.[0]?.content).toBe(
        '{"message":"Task completed successfully","needsMoreInfo":false}',
      );
    });

    it('should handle FinishToolResponse with needsMoreInfo and NOT set done to true', async () => {
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
      mockState.done = false;
      mockState.needsMoreInfo = false;
      mockFinishTool.invoke = vi
        .fn()
        .mockResolvedValue(
          new FinishToolResponse('What is the target environment?', true),
        );

      const result = await node.invoke(mockState, mockConfig);

      expect(result.done).toBeUndefined(); // Should not set done when needsMoreInfo is true
      expect(result.needsMoreInfo).toBe(true); // Should set needsMoreInfo to true
      expect(result.messages?.items?.[0]?.content).toBe(
        '{"message":"What is the target environment?","needsMoreInfo":true}',
      );
    });
  });
});
