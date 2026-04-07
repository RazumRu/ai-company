import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import {
  CompiledGraphNode,
  GraphNode,
  GraphNodeInstanceHandle,
  GraphNodeStatus,
  NodeKind,
} from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import type { SystemAgentDefinition } from '../system-agents.types';
import { SystemAgentTemplateFactory } from './system-agent-template.factory';

const makeHandle = <TInstance>(
  instance: TInstance,
): GraphNodeInstanceHandle<TInstance, unknown> => ({
  provide: async () => instance,
  configure: async () => {},
  destroy: async () => {},
});

const buildCompiledNode = <TInstance>(options: {
  id: string;
  type: NodeKind;
  template: string;
  instance: TInstance;
  config?: unknown;
}): CompiledGraphNode<TInstance> =>
  ({
    ...options,
    handle: makeHandle(options.instance),
    config: options.config ?? {},
    getStatus: () => GraphNodeStatus.Idle,
  }) as unknown as CompiledGraphNode<TInstance>;

const ENGINEER_DEFINITION: SystemAgentDefinition = {
  id: 'engineer',
  name: 'Engineer',
  description: 'A software engineer agent.',
  tools: ['shell-tool', 'files-tool'],
  defaultModel: null,
  instructions: 'You are a senior software engineer.',
  contentHash: 'abc123def456',
  templateId: 'system-agent-engineer',
};

describe('SystemAgentTemplateFactory', () => {
  let factory: SystemAgentTemplateFactory;
  let mockSimpleAgent: SimpleAgent;
  let mockModuleRef: ModuleRef;
  let mockGraphRegistry: GraphRegistry;

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const addedTools: unknown[] = [];
    mockSimpleAgent = {
      addTool: vi.fn((tool: unknown) => {
        addedTools.push(tool);
      }),
      resetTools: vi.fn(),
      run: vi.fn(),
      setConfig: vi.fn(),
      initTools: vi.fn().mockResolvedValue(undefined),
      setMcpServices: vi.fn(),
      getTools: vi.fn(() => addedTools),
      stop: vi.fn(),
    } as unknown as SimpleAgent;

    mockModuleRef = {
      resolve: vi.fn().mockResolvedValue(mockSimpleAgent),
    } as unknown as ModuleRef;

    mockGraphRegistry = {
      getNode: vi.fn().mockReturnValue(undefined),
    } as unknown as GraphRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemAgentTemplateFactory,
        { provide: ModuleRef, useValue: mockModuleRef },
        { provide: GraphRegistry, useValue: mockGraphRegistry },
      ],
    }).compile();

    factory = module.get<SystemAgentTemplateFactory>(
      SystemAgentTemplateFactory,
    );
  });

  describe('createTemplate', () => {
    it('returns a template with correct id', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.id).toBe('system-agent-engineer');
    });

    it('returns a template with correct name', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.name).toBe('Engineer');
    });

    it('returns a template with correct description', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.description).toBe('A software engineer agent.');
    });

    it('returns a template with SimpleAgent kind', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.kind).toBe(NodeKind.SimpleAgent);
    });

    it('returns a template with correct inputs', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.inputs).toEqual([
        { type: 'template', value: 'agent-communication-tool', multiple: true },
        { type: 'kind', value: NodeKind.Trigger, multiple: true },
      ]);
    });

    it('returns a template with correct outputs', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(template.outputs).toEqual([
        { type: 'kind', value: NodeKind.Tool, multiple: true },
        { type: 'kind', value: NodeKind.Mcp, multiple: true },
      ]);
    });

    it('exposes systemAgentId metadata', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(
        (template as unknown as Record<string, unknown>).systemAgentId,
      ).toBe('engineer');
    });

    it('exposes systemAgentContentHash metadata', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(
        (template as unknown as Record<string, unknown>).systemAgentContentHash,
      ).toBe('abc123def456');
    });

    it('exposes systemAgentPredefinedTools metadata', () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      expect(
        (template as unknown as Record<string, unknown>)
          .systemAgentPredefinedTools,
      ).toEqual(['shell-tool', 'files-tool']);
    });

    it('includes invokeModelName with defaultModel as default when def.defaultModel is set', () => {
      const defWithModel: SystemAgentDefinition = {
        ...ENGINEER_DEFINITION,
        defaultModel: 'gpt-4o',
      };
      const template = factory.createTemplate(defWithModel);
      const schema = (template as unknown as Record<string, unknown>)
        .schema as {
        shape: Record<string, { _def: { defaultValue: unknown } }>;
      };
      expect(schema.shape).toHaveProperty('invokeModelName');
      const invokeModelField = schema.shape['invokeModelName'];
      expect(invokeModelField).toBeDefined();
      expect(invokeModelField!._def.defaultValue).toBe('gpt-4o');
    });
  });

  describe('template.create() — configure', () => {
    const baseConfig = {
      name: 'Engineer',
      description: 'A software engineer agent.',
      instructions: 'You are a senior software engineer.',
      invokeModelName: 'gpt-4o',
      systemAgentId: 'engineer',
      systemAgentContentHash: 'abc123def456',
    };

    const metadata = {
      graphId: 'test-graph',
      nodeId: 'test-node',
      version: '1.0.0',
      graph_created_by: 'user-1',
      graph_project_id: '11111111-1111-1111-1111-111111111111',
    };

    it('provides a SimpleAgent instance', async () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof baseConfig> = {
        config: baseConfig,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(params);
      expect(instance).toBe(mockSimpleAgent);
    });

    it('calls resetTools before adding tools', async () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof baseConfig> = {
        config: baseConfig,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(params);
      await handle.configure(params, instance);
      expect(mockSimpleAgent.resetTools).toHaveBeenCalled();
    });

    it('uses def.instructions as base (not config.instructions) for final config', async () => {
      const configWithModifiedInstructions = {
        ...baseConfig,
        instructions: 'User-modified instructions (should be ignored)',
      };
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof configWithModifiedInstructions> = {
        config: configWithModifiedInstructions,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(params);
      await handle.configure(params, instance);

      const finalConfigCall = vi
        .mocked(mockSimpleAgent.setConfig)
        .mock.calls.at(1);
      expect(finalConfigCall).toBeDefined();
      const finalConfig = finalConfigCall![0] as { instructions: string };
      expect(finalConfig.instructions).toContain(
        ENGINEER_DEFINITION.instructions,
      );
    });

    it('appends additionalInstructions to base instructions', async () => {
      const configWithAdditional = {
        ...baseConfig,
        additionalInstructions: 'Also follow these extra rules.',
      };
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof configWithAdditional> = {
        config: configWithAdditional,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(params);
      await handle.configure(params, instance);

      const finalConfigCall = vi
        .mocked(mockSimpleAgent.setConfig)
        .mock.calls.at(1);
      expect(finalConfigCall).toBeDefined();
      const finalConfig = finalConfigCall![0] as { instructions: string };
      expect(finalConfig.instructions).toContain(
        'Also follow these extra rules.',
      );
      expect(finalConfig.instructions).toContain(
        ENGINEER_DEFINITION.instructions,
      );
    });

    it('collects tools from connected tool nodes', async () => {
      const tool = { name: 'shell-tool', __instructions: undefined };
      const toolNode = buildCompiledNode({
        id: 'tool-node-1',
        type: NodeKind.Tool,
        template: 'shell-tool',
        instance: [tool],
      });

      vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, id) => {
        if (id === 'tool-node-1') {
          return toolNode;
        }
        return undefined;
      });

      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof baseConfig> = {
        config: baseConfig,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(['tool-node-1']),
        metadata,
      };
      const instance = await handle.provide(params);
      await handle.configure(params, instance);

      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(tool);
    });

    it('calls destroy (stop) on the agent', async () => {
      const template = factory.createTemplate(ENGINEER_DEFINITION);
      const handle = await template.create();
      const params: GraphNode<typeof baseConfig> = {
        config: baseConfig,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(params);
      await handle.destroy(instance);

      expect(mockSimpleAgent.stop).toHaveBeenCalled();
    });
  });
});
