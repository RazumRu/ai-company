import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationExecTool } from './communication-exec.tool';
import { CommunicationToolGroup } from './communication-tool-group';
import { AgentInfo } from './communication-tools.types';

describe('CommunicationToolGroup', () => {
  let toolGroup: CommunicationToolGroup;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommunicationToolGroup, CommunicationExecTool],
    }).compile();

    toolGroup = module.get<CommunicationToolGroup>(CommunicationToolGroup);
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

      const result = toolGroup.buildTools({ agents });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe('communication_exec');
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

      const result = toolGroup.buildTools({ agents });

      // Tool should be properly configured
      expect(result.tools[0]).toBeDefined();
    });

    it('should work with empty agents array', () => {
      const result = toolGroup.buildTools({ agents: [] });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe('communication_exec');
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

      const result = toolGroup.buildTools({ agents }, lgConfig);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]).toBeDefined();
    });
  });
});
