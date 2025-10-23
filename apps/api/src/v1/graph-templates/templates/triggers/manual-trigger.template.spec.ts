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
    it('should validate optional threadId', () => {
      const validConfig = {
        threadId: 'thread-1',
      };

      expect(() =>
        ManualTriggerTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should work with empty config', () => {
      const validConfig = {};

      expect(() =>
        ManualTriggerTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should validate optional threadId', () => {
      const validConfig = {
        threadId: 'thread-1',
      };

      expect(() =>
        ManualTriggerTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });
  });

  describe('create', () => {
    it('should throw NotFoundException when no agent nodes found in output connections', async () => {
      const config = {};

      await expect(
        template.create(config, new Map(), new Map(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException with correct error message', async () => {
      const config = {};

      await expect(
        template.create(config, new Map(), new Map(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(
        'No agent nodes found in output connections for trigger',
      );
    });

    it('should create manual trigger with valid agent node', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-5-mini',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const outputNodes = new Map([['agent-1', agentNode]]);

      const config = {
        threadId: 'test-thread',
      };

      const result = await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

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
        invokeModelName: 'gpt-5-mini',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {
        threadId: 'test-thread',
      };

      await template.create(config, new Map(), compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Get the invoke agent function that was passed
      const setInvokeAgentCall = (mockManualTrigger.setInvokeAgent as any).mock
        .calls[0];
      const invokeAgentFn = setInvokeAgentCall[0];

      // Test the invoke agent function (with thread component as service would pass it)
      const messages = [new HumanMessage('test')];
      const threadComponent = 'thread-123';
      const expectedFullThreadId = `test-graph:${threadComponent}`;
      const runnableConfig = {
        configurable: {
          thread_id: threadComponent, // Service passes just the thread component
        },
      };

      await invokeAgentFn(messages, runnableConfig);

      const runCall = (mockSimpleAgent.run as any).mock.calls[0];
      const [
        actualThreadId,
        actualMessages,
        actualConfig,
        actualRunnableConfig,
      ] = runCall;

      expect(actualThreadId).toBe(expectedFullThreadId);
      expect(actualMessages).toEqual(messages);
      expect(actualConfig).toEqual(agentConfig);
      expect(actualRunnableConfig.configurable).toMatchObject({
        thread_id: expectedFullThreadId,
        graph_id: 'test-graph',
        node_id: 'agent-1', // Uses agent's nodeId
      });
      // checkpoint_ns should be threadId:agentNodeId
      expect(actualRunnableConfig.configurable.checkpoint_ns).toBe(
        `${expectedFullThreadId}:agent-1`,
      );
    });

    it('should use default thread_id if not provided in config', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-5-mini',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {};

      await template.create(config, new Map(), compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

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

      const runCall = (mockSimpleAgent.run as any).mock.calls[0];
      const [
        actualThreadId,
        actualMessages,
        actualConfig,
        actualRunnableConfig,
      ] = runCall;

      // thread_id should be auto-generated as graphId:uuid when not provided
      expect(actualThreadId).toMatch(/^test-graph:[a-f0-9-]{36}$/);
      expect(actualMessages).toEqual(messages);
      expect(actualConfig).toEqual(agentConfig);
      expect(actualRunnableConfig.configurable.graph_id).toBe('test-graph');
      expect(actualRunnableConfig.configurable.node_id).toBe('agent-1');

      // checkpoint_ns should be graphId:threadComponent:nodeId
      const threadComponent = actualThreadId.split(':')[1];
      expect(actualRunnableConfig.configurable.checkpoint_ns).toBe(
        `test-graph:${threadComponent}:agent-1`,
      );
    });
  });

  describe('Metadata Propagation', () => {
    it('should preserve existing configurable properties when enriching', async () => {
      const agentConfig = {
        name: 'Test Agent',
        instructions: 'Test',
        invokeModelName: 'gpt-5-mini',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
      };

      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockSimpleAgent,
          config: agentConfig,
        },
      };

      const compiledNodes = new Map([['agent-1', agentNode]]);

      const config = {};

      await template.create(config, new Map(), compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      const setInvokeAgentCall = (mockManualTrigger.setInvokeAgent as any).mock
        .calls[0];
      const invokeAgentFn = setInvokeAgentCall[0];

      const threadComponent = 'test-thread-789';
      const expectedFullThreadId = `test-graph:${threadComponent}`;
      const runnableConfig = {
        configurable: {
          thread_id: threadComponent, // Service passes just the thread component
          caller_agent: {} as any,
          graph_id: 'existing-graph',
          node_id: 'existing-node',
        },
      };

      const messages = [new HumanMessage('test')];

      await invokeAgentFn(messages, runnableConfig);

      const runCall = (mockSimpleAgent.run as any).mock.calls[0];
      const [
        actualThreadId,
        actualMessages,
        actualConfig,
        actualRunnableConfig,
      ] = runCall;

      // Verify that existing properties are preserved and new ones override
      expect(actualThreadId).toBe(expectedFullThreadId);
      expect(actualMessages).toEqual(messages);
      expect(actualConfig).toEqual(agentConfig);
      expect(actualRunnableConfig.configurable.thread_id).toBe(
        expectedFullThreadId,
      );
      expect(actualRunnableConfig.configurable.caller_agent).toBeDefined();
      expect(actualRunnableConfig.configurable.graph_id).toBe('test-graph'); // Should be overridden with template metadata
      expect(actualRunnableConfig.configurable.node_id).toBe('agent-1'); // Uses agent's nodeId

      // checkpoint_ns should be threadId:agentNodeId
      expect(actualRunnableConfig.configurable.checkpoint_ns).toBe(
        `${expectedFullThreadId}:agent-1`,
      );
    });
  });
});
