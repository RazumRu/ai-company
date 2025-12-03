import { ToolRunnableConfig } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { CommunicationListTool } from './communication-list.tool';
import { AgentInfo } from './communication-tools.types';

describe('CommunicationListTool', () => {
  let tool: CommunicationListTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommunicationListTool],
    }).compile();

    tool = module.get<CommunicationListTool>(CommunicationListTool);
  });

  describe('schema', () => {
    it('should accept empty object', () => {
      const validData = {};

      expect(() => tool.schema.parse(validData)).not.toThrow();
    });
  });

  describe('invoke', () => {
    it('should return list of agents with names and descriptions', async () => {
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

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      const result = await tool.invoke({}, { agents }, mockRunnableConfig);

      expect(result).toEqual([
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
        },
        {
          name: 'coding-agent',
          description: 'Agent for coding tasks',
        },
      ]);
    });

    it('should return empty array when no agents are configured', async () => {
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      const result = await tool.invoke({}, { agents: [] }, mockRunnableConfig);

      expect(result).toEqual([]);
    });

    it('should return empty array when agents config is undefined', async () => {
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'test-thread' },
      };

      const result = await tool.invoke(
        {},
        { agents: undefined as any },
        mockRunnableConfig,
      );

      expect(result).toEqual([]);
    });

    it('should not include invokeAgent function in the result', async () => {
      const mockInvokeAgent = vi.fn();

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

      const result = await tool.invoke({}, { agents }, mockRunnableConfig);

      expect(result[0]).not.toHaveProperty('invokeAgent');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('description');
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const mockInvokeAgent = vi.fn();

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
      expect(builtTool.name).toBe('communication_list');
    });
  });
});
