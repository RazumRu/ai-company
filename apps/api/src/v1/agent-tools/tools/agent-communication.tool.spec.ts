import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    it('should validate required fields', () => {
      const validData = {
        messages: ['Hello, can you help me?'],
      };

      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const invalidData = {
        // missing messages and childThreadId
      };

      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should limit messages to 10', () => {
      const tooManyMessages = {
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
      const mockRunnableConfig = {
        configurable: { thread_id: 'test-thread' },
      };

      const result = await tool.invoke(
        {
          messages: ['Hello'],
        },
        { invokeAgent: mockInvokeAgent },
        mockRunnableConfig as any,
      );

      expect(mockInvokeAgent).toHaveBeenCalledWith(
        ['Hello'],
        mockRunnableConfig,
      );

      expect(result).toEqual({ response: 'test response' });
    });

    it('should throw error when invokeAgent is not configured', async () => {
      const mockRunnableConfig = {
        configurable: { thread_id: 'test-thread' },
      };

      await expect(
        tool.invoke(
          {
            messages: ['Hello'],
          },
          {} as any,
          mockRunnableConfig as any,
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
      expect(builtTool.name).toBe('agent-communication');
    });
  });
});
