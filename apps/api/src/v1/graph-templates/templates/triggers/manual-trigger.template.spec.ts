import { HumanMessage } from '@langchain/core/messages';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ManualTrigger } from '../../../agent-triggers/services/manual-trigger';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { SimpleAgentTemplateResult } from '../base-node.template';
import {
  ManualTriggerTemplate,
  ManualTriggerTemplateSchema,
} from './manual-trigger.template';

describe('ManualTriggerTemplate', () => {
  let template: ManualTriggerTemplate;
  let mockModuleRef: ModuleRef;
  let mockManualTrigger: ManualTrigger;
  let mockSimpleAgent: SimpleAgent;

  beforeEach(async () => {
    mockSimpleAgent = {
      run: vi.fn(),
    } as any;

    mockManualTrigger = {
      setInvokeAgent: vi.fn(),
      start: vi.fn(),
      getStatus: vi.fn().mockReturnValue('listening'),
    } as any;

    mockModuleRef = {
      resolve: vi.fn().mockResolvedValue(mockManualTrigger),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          appName: 'test',
          appVersion: '1.0.0',
          environment: 'test',
          prettyPrint: true,
          level: 'debug',
        }),
      ],
      providers: [
        ManualTriggerTemplate,
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
        },
      ],
    }).compile();

    template = module.get<ManualTriggerTemplate>(ManualTriggerTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('manual-trigger');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'Manual trigger for direct agent invocation',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Trigger);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(ManualTriggerTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate required agentId', () => {
      const validConfig = {
        agentId: 'agent-1',
      };

      expect(() =>
        ManualTriggerTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should reject missing agentId', () => {
      const invalidConfig = {};

      expect(() => ManualTriggerTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject empty agentId', () => {
      const invalidConfig = {
        agentId: '',
      };

      expect(() => ManualTriggerTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should validate optional threadId', () => {
      const validConfig = {
        agentId: 'agent-1',
        threadId: 'thread-1',
      };

      expect(() =>
        ManualTriggerTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });
  });

  describe('create', () => {
    it('should throw NotFoundException when agent node not found', async () => {
      const emptyCompiledNodes = new Map();

      const config = {
        agentId: 'non-existent-agent',
      };

      await expect(template.create(config, emptyCompiledNodes)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException with correct error message', async () => {
      const emptyCompiledNodes = new Map();

      const config = {
        agentId: 'missing-agent',
      };

      await expect(template.create(config, emptyCompiledNodes)).rejects.toThrow(
        'Agent missing-agent not found for trigger',
      );
    });

    it('should create manual trigger with valid agent node', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-4',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {
        agentId: 'agent-1',
        threadId: 'test-thread',
      };

      const result = await template.create(config, compiledNodes);

      expect(result).toBe(mockManualTrigger);
      expect(mockModuleRef.resolve).toHaveBeenCalledWith(
        ManualTrigger,
        undefined,
        {
          strict: false,
        },
      );
      expect(mockManualTrigger.setInvokeAgent).toHaveBeenCalledWith(
        expect.any(Function),
      );
      expect(mockManualTrigger.start).toHaveBeenCalled();
    });

    it('should configure trigger to invoke agent correctly', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-4',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {
        agentId: 'agent-1',
        threadId: 'test-thread',
      };

      await template.create(config, compiledNodes);

      // Get the invoke agent function that was passed
      const setInvokeAgentCall = (mockManualTrigger.setInvokeAgent as any).mock
        .calls[0];
      const invokeAgentFn = setInvokeAgentCall[0];

      // Test the invoke agent function
      const messages = [new HumanMessage('test')];
      const runnableConfig = {
        configurable: {
          thread_id: 'thread-123',
        },
      };

      await invokeAgentFn(messages, runnableConfig);

      expect(mockSimpleAgent.run).toHaveBeenCalledWith(
        'thread-123',
        messages,
        agentConfig,
        runnableConfig,
      );
    });

    it('should use default thread_id if not provided in config', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-4',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {
        agentId: 'agent-1',
      };

      await template.create(config, compiledNodes);

      // Get the invoke agent function
      const setInvokeAgentCall = (mockManualTrigger.setInvokeAgent as any).mock
        .calls[0];
      const invokeAgentFn = setInvokeAgentCall[0];

      // Test with missing thread_id
      const messages = [new HumanMessage('test')];
      const runnableConfig = {
        configurable: {},
      };

      await invokeAgentFn(messages, runnableConfig);

      expect(mockSimpleAgent.run).toHaveBeenCalledWith(
        expect.stringMatching(/.+/),
        messages,
        agentConfig,
        runnableConfig,
      );
    });
  });
});
