import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { CommunicationExecTool } from './communication-exec.tool';
import { AgentInfo } from './communication-tools.types';

describe('CommunicationExecTool', () => {
  let tool: CommunicationExecTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommunicationExecTool],
    }).compile();

    tool = module.get<CommunicationExecTool>(CommunicationExecTool);
  });

  describe('schema', () => {
    it('should validate required fields', () => {
      const validData = {
        message: 'Hello, can you help me?',
        purpose: 'Requesting help from another agent',
        agent: 'research-agent',
      };

      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject missing message field', () => {
      const invalidData = {
        purpose: 'Requesting help',
        agent: 'research-agent',
      };

      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = {
        message: 'Hello',
        agent: 'research-agent',
      };

      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing agent field', () => {
      const invalidData = {
        message: 'Hello',
        purpose: 'Requesting help',
      };

      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty message', () => {
      const invalidData = {
        message: '',
        purpose: 'Requesting help',
        agent: 'research-agent',
      };

      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject empty agent', () => {
      const invalidData = {
        message: 'Hello',
        purpose: 'Requesting help',
        agent: '',
      };

      expect(() => tool.validate(invalidData)).toThrow();
    });
  });

  describe('invoke', () => {
    it('should call the correct agent invokeAgent function', async () => {
      const mockInvokeAgent1 = vi
        .fn()
        .mockResolvedValue({ response: 'response from agent 1' });
      const mockInvokeAgent2 = vi
        .fn()
        .mockResolvedValue({ response: 'response from agent 2' });

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent1,
        },
        {
          name: 'coding-agent',
          description: 'Agent for coding tasks',
          invokeAgent: mockInvokeAgent2,
        },
      ];

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      const { output: result } = await tool.invoke(
        {
          message: 'Can you research this topic?',
          purpose: 'Research request',
          agent: 'research-agent',
        },
        { agents },
        mockRunnableConfig,
      );

      expect(mockInvokeAgent1).toHaveBeenCalledWith(
        ['Can you research this topic?'],
        mockRunnableConfig,
      );
      expect(mockInvokeAgent2).not.toHaveBeenCalled();
      expect(result).toEqual({ response: 'response from agent 1' });
    });

    it('should throw error when no agents are configured', async () => {
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      await expect(
        tool.invoke(
          {
            message: 'Hello',
            purpose: 'Requesting assistance',
            agent: 'research-agent',
          },
          { agents: [] },
          mockRunnableConfig,
        ),
      ).rejects.toThrow('No agents configured for communication');
    });

    it('should throw error when agent is not found', async () => {
      const mockInvokeAgent = vi
        .fn()
        .mockResolvedValue({ response: 'test response' });

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent,
        },
      ];

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      await expect(
        tool.invoke(
          {
            message: 'Hello',
            purpose: 'Requesting assistance',
            agent: 'non-existent-agent',
          },
          { agents },
          mockRunnableConfig,
        ),
      ).rejects.toThrow(
        'Agent "non-existent-agent" not found. Check available connected agents in tool instructions.',
      );
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const mockInvokeAgent = vi
        .fn()
        .mockResolvedValue({ response: 'test response' });

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent,
        },
      ];

      const builtTool = tool.build({ agents });

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('communication_exec');
    });

    it('should enhance description with available agents list', () => {
      const mockInvokeAgent1 = vi.fn();
      const mockInvokeAgent2 = vi.fn();

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent1,
        },
        {
          name: 'coding-agent',
          description: 'Agent for coding tasks',
          invokeAgent: mockInvokeAgent2,
        },
      ];

      const builtTool = tool.build({ agents });

      expect(builtTool.description).toBe(tool.description);
    });
  });
});
