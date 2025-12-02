import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { AgentCommunicationTool } from './agent-communication.tool';

describe('AgentCommunicationTool', () => {
  let tool: AgentCommunicationTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentCommunicationTool],
    }).compile();

    tool = module.get<AgentCommunicationTool>(AgentCommunicationTool);
  });

  describe('schema', () => {
    it('should validate required purpose and messages fields', () => {
      const validData = {
        purpose: 'Requesting help from another agent',
        messages: ['Hello, can you help me?'],
      };

      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = {
        messages: ['Hello, can you help me?'],
      };

      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing messages field', () => {
      const invalidData = {
        purpose: 'Requesting help',
      };

      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty purpose', () => {
      const invalidData = {
        purpose: '',
        messages: ['Hello, can you help me?'],
      };

      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should limit messages to 10', () => {
      const tooManyMessages = {
        purpose: 'Sending multiple messages',
        messages: Array(11).fill('message'),
      };

      expect(() => tool.schema.parse(tooManyMessages)).toThrow();
    });
  });

  describe('invoke', () => {
    it('should call invokeAgent with correct parameters', async () => {
      const mockInvokeAgent = vi
        .fn()
        .mockResolvedValue({ response: 'test response' });
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      const result = await tool.invoke(
        {
          purpose: 'Requesting assistance',
          messages: ['Hello'],
        },
        { invokeAgent: mockInvokeAgent },
        mockRunnableConfig,
      );

      expect(mockInvokeAgent).toHaveBeenCalledWith(
        ['Hello'],
        mockRunnableConfig,
      );

      expect(result).toEqual({ response: 'test response' });
    });

    it('should throw error when invokeAgent is not configured', async () => {
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      await expect(
        tool.invoke(
          {
            purpose: 'Requesting assistance',
            messages: ['Hello'],
          },
          { invokeAgent: null as any },
          mockRunnableConfig,
        ),
      ).rejects.toThrow('Agent communication is not configured');
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const mockInvokeAgent = vi
        .fn()
        .mockResolvedValue({ response: 'test response' });
      const builtTool = tool.build({ invokeAgent: mockInvokeAgent });

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('agent_communication');
    });
  });
});
