import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationExecTool } from './communication-exec.tool';
import { CommunicationListTool } from './communication-list.tool';
import { CommunicationToolGroup } from './communication-tool-group';
import { AgentInfo } from './communication-tools.types';

describe('CommunicationToolGroup', () => {
  let toolGroup: CommunicationToolGroup;
  let communicationExecTool: CommunicationExecTool;
  let communicationListTool: CommunicationListTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunicationToolGroup,
        CommunicationExecTool,
        CommunicationListTool,
      ],
    }).compile();

    toolGroup = module.get<CommunicationToolGroup>(CommunicationToolGroup);
    communicationExecTool = module.get<CommunicationExecTool>(
      CommunicationExecTool,
    );
    communicationListTool = module.get<CommunicationListTool>(
      CommunicationListTool,
    );
  });

  describe('buildTools', () => {
    it('should create both communication_exec and communication_list tools', () => {
      const mockInvokeAgent = vi.fn();

      const agents: AgentInfo[] = [
        {
          name: 'research-agent',
          description: 'Agent for research tasks',
          invokeAgent: mockInvokeAgent,
        },
      ];

      const tools = toolGroup.buildTools({ agents });

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('communication_exec');
      expect(tools[1]?.name).toBe('communication_list');
    });

    it('should pass config to both tools', () => {
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

      // Verify exec tool has agents in description
      expect(tools[0]?.description).toContain('research-agent');
      expect(tools[0]?.description).toContain('coding-agent');

      // Both tools should be properly configured
      expect(tools[0]).toBeDefined();
      expect(tools[1]).toBeDefined();
    });

    it('should work with empty agents array', () => {
      const tools = toolGroup.buildTools({ agents: [] });

      expect(tools).toHaveLength(2);
      expect(tools[0]?.name).toBe('communication_exec');
      expect(tools[1]?.name).toBe('communication_list');
    });

    it('should pass lgConfig to tools', () => {
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

      expect(tools).toHaveLength(2);
      // Both tools should be built successfully
      expect(tools[0]).toBeDefined();
      expect(tools[1]).toBeDefined();
    });
  });
});
