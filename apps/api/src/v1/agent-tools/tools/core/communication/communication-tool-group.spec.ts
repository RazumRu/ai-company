import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationExecTool } from './communication-exec.tool';
import { CommunicationToolGroup } from './communication-tool-group';
import { AgentInfo } from './communication-tools.types';

describe('CommunicationToolGroup', () => {
  let toolGroup: CommunicationToolGroup;
  let communicationExecTool: CommunicationExecTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommunicationToolGroup, CommunicationExecTool],
    }).compile();

    toolGroup = module.get<CommunicationToolGroup>(CommunicationToolGroup);
    communicationExecTool = module.get<CommunicationExecTool>(
      CommunicationExecTool,
    );
  });

  describe('buildTools', () => {
    it('should create communication_exec tool', () => {
      const mockInvokeAgent = vi.fn();

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent,
        },
      ];

      const tools = toolGroup.buildTools({ agents });

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('communication_exec');
    });

    it('should pass config to tool', () => {
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

      const tools = toolGroup.buildTools({ agents });

      // Tool should be properly configured
      expect(tools[0]).toBeDefined();
    });

    it('should work with empty agents array', () => {
      const tools = toolGroup.buildTools({ agents: [] });

      expect(tools).toHaveLength(1);
      expect(tools[0]?.name).toBe('communication_exec');
    });

    it('should pass lgConfig to tool', () => {
      const mockInvokeAgent = vi.fn();

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent,
        },
      ];

      const lgConfig = {
        description: 'Custom description',
      };

      const tools = toolGroup.buildTools({ agents }, lgConfig);

      expect(tools).toHaveLength(1);
      expect(tools[0]).toBeDefined();
    });
  });
});
