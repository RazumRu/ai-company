import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NodeBaseTemplate } from '../../graph-templates/templates/base-node.template';
import { GraphEntity } from '../entity/graph.entity';
import { GraphSchemaType, GraphStatus, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';
import { GraphStateFactory } from './graph-state.factory';

// Mock DockerRuntime
vi.mock('../../runtime/services/docker-runtime', () => ({
  DockerRuntime: {
    cleanupByLabels: vi.fn(),
  },
}));

describe('GraphCompiler', () => {
  let compiler: GraphCompiler;
  let templateRegistry: TemplateRegistry;
  let _mockGraphRegistry: GraphRegistry;
  let mockGraphStateManager: {
    registerNode: ReturnType<typeof vi.fn>;
    attachGraphNode: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  const createMockHandle = (instance: any) => ({
    provide: vi.fn().mockResolvedValue(instance),
    configure: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  });

  const createMockTemplate = (kind: NodeKind) => {
    let inputs: any[] = [];
    let outputs: any[] = [];

    if (kind === NodeKind.Tool) {
      inputs = [{ type: 'kind', value: NodeKind.SimpleAgent, multiple: true }];
      outputs = [
        { type: 'kind', value: NodeKind.Runtime, multiple: false },
        { type: 'kind', value: NodeKind.Resource, multiple: true },
      ];
    } else if (kind === NodeKind.SimpleAgent) {
      outputs = [
        { type: 'kind', value: NodeKind.Tool, multiple: true },
        { type: 'kind', value: NodeKind.Runtime, multiple: true },
      ];
    } else if (kind === NodeKind.Runtime) {
      inputs = [
        { type: 'kind', value: NodeKind.Tool, multiple: true },
        { type: 'kind', value: NodeKind.SimpleAgent, multiple: true },
      ];
    } else if (kind === NodeKind.Resource) {
      inputs = [{ type: 'kind', value: NodeKind.Tool, multiple: false }];
    }

    return {
      id: `mock-${kind}`,
      name: `mock-${kind}`,
      description: `Mock ${kind} template`,
      kind,
      schema: z.object({}),
      inputs,
      outputs,
      create: vi
        .fn()
        .mockImplementation(() => Promise.resolve(createMockHandle({}))),
    } as unknown as NodeBaseTemplate<z.ZodTypeAny, unknown>;
  };

  const createMockGraphEntity = (
    schema: GraphSchemaType,
    id = 'test-graph',
    name = 'Test Graph',
    version = '1.0.0',
  ): GraphEntity => ({
    id,
    name,
    version,
    targetVersion: version,
    description: 'Test Description',
    schema,
    status: GraphStatus.Created,
    createdBy: 'test-user',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
    temporary: false,
  });

  beforeEach(async () => {
    mockGraphStateManager = {
      registerNode: vi.fn(),
      attachGraphNode: vi.fn(),
      destroy: vi.fn(),
    };

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
        GraphCompiler,
        {
          provide: TemplateRegistry,
          useValue: {
            getTemplate: vi.fn(),
            hasTemplate: vi.fn().mockReturnValue(true),
            validateTemplateConfig: vi.fn().mockImplementation((_t, c) => c),
          },
        },
        {
          provide: GraphRegistry,
          useValue: {
            register: vi.fn(),
            unregister: vi.fn(),
            setStatus: vi.fn(),
          },
        },
        {
          provide: GraphStateFactory,
          useValue: {
            create: vi.fn().mockReturnValue(mockGraphStateManager),
          },
        },
      ],
    }).compile();

    compiler = module.get<GraphCompiler>(GraphCompiler);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
    _mockGraphRegistry = module.get<GraphRegistry>(GraphRegistry);
  });

  describe('compile', () => {
    it('should compile a valid graph schema with single runtime', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { image: 'node:18' },
          },
        ],
        edges: [],
      };

      const mockTemplate = createMockTemplate(NodeKind.Runtime);
      const mockHandle = createMockHandle({ container: 'runtime-instance' });
      vi.mocked(mockTemplate.create).mockResolvedValue(mockHandle as any);
      vi.mocked(templateRegistry.getTemplate).mockReturnValue(mockTemplate);

      const graph = createMockGraphEntity(schema);
      const compiled = await compiler.compile(graph);

      expect(compiled.nodes.size).toBe(1);
      const node = compiled.nodes.get('runtime-1');
      expect(node).toBeDefined();
      expect(node?.id).toBe('runtime-1');
      expect(node?.handle).toBe(mockHandle);
      expect(mockHandle.configure).toHaveBeenCalled();
      expect(mockGraphStateManager.registerNode).toHaveBeenCalledWith(
        'runtime-1',
      );
      expect(mockGraphStateManager.attachGraphNode).toHaveBeenCalledWith(
        'runtime-1',
        expect.anything(),
      );
    });

    it('should compile graph with runtime and tool', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {},
          },
          {
            id: 'tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [{ from: 'tool-1', to: 'runtime-1' }],
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);

      const runtimeHandle = createMockHandle({ id: 'rt' });
      const toolHandle = createMockHandle({ id: 'tool' });

      vi.mocked(runtimeTemplate.create).mockResolvedValue(runtimeHandle as any);
      vi.mocked(toolTemplate.create).mockResolvedValue(toolHandle as any);

      vi.mocked(templateRegistry.getTemplate).mockImplementation(
        (templateId) => {
          if (templateId === 'docker-runtime') return runtimeTemplate;
          if (templateId === 'shell-tool') return toolTemplate;
          return undefined;
        },
      );

      const graph = createMockGraphEntity(schema);
      const compiled = await compiler.compile(graph);

      expect(compiled.nodes.size).toBe(2);
      expect(runtimeHandle.configure).toHaveBeenCalled();
      expect(toolHandle.configure).toHaveBeenCalled();

      // Edge semantics: tool depends on runtime, so runtime is built first
      // When tool is configured, runtime is already in compiledNodes
      const toolInit = vi.mocked(toolHandle.configure).mock.calls[0]![0] as any;
      expect(toolInit.outputNodeIds).toContain('runtime-1');
    });

    it('should compile complex graph with multiple runtimes, tools, and agents', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          { id: 'rt1', template: 'rt', config: {} },
          { id: 'rt2', template: 'rt', config: {} },
          { id: 'tool1', template: 'tool', config: {} },
          { id: 'agent1', template: 'agent', config: {} },
        ],
        edges: [
          { from: 'tool1', to: 'rt1' },
          { from: 'agent1', to: 'tool1' },
          { from: 'agent1', to: 'rt2' },
        ],
      };

      const rtTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);
      const agentTemplate = createMockTemplate(NodeKind.SimpleAgent);

      vi.mocked(templateRegistry.getTemplate).mockImplementation((id) => {
        if (id === 'rt') return rtTemplate;
        if (id === 'tool') return toolTemplate;
        if (id === 'agent') return agentTemplate;
        return undefined;
      });

      const graph = createMockGraphEntity(schema);
      const compiled = await compiler.compile(graph);

      expect(compiled.nodes.size).toBe(4);
      expect(mockGraphStateManager.registerNode).toHaveBeenCalledTimes(4);
    });

    it('should build nodes in correct dependency order', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          { id: 'agent', template: 'agent', config: {} },
          { id: 'tool', template: 'tool', config: {} },
          { id: 'rt', template: 'rt', config: {} },
        ],
        edges: [
          { from: 'agent', to: 'tool' },
          { from: 'tool', to: 'rt' },
        ],
      };

      const rtTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);
      const agentTemplate = createMockTemplate(NodeKind.SimpleAgent);

      vi.mocked(templateRegistry.getTemplate).mockImplementation((id) => {
        if (id === 'rt') return rtTemplate;
        if (id === 'tool') return toolTemplate;
        if (id === 'agent') return agentTemplate;
        return undefined;
      });

      const graph = createMockGraphEntity(schema);
      await compiler.compile(graph);

      const registerOrder = mockGraphStateManager.registerNode.mock.calls.map(
        (call) => call[0],
      );

      // Edge semantics: edge.from depends on edge.to
      // agent -> tool means agent depends on tool
      // tool -> rt means tool depends on rt
      // Build order: rt (0 dependencies), tool (depends on rt), agent (depends on tool)
      expect(registerOrder).toEqual(['rt', 'tool', 'agent']);
    });

    it('should handle graph without edges', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          { id: 'n1', template: 't', config: {} },
          { id: 'n2', template: 't', config: {} },
        ],
        edges: [],
      };

      const template = createMockTemplate(NodeKind.Runtime);
      vi.mocked(templateRegistry.getTemplate).mockReturnValue(template);

      const graph = createMockGraphEntity(schema);
      const compiled = await compiler.compile(graph);

      expect(compiled.nodes.size).toBe(2);
    });

    it('should pass config and metadata to handle.provide', async () => {
      const schema: GraphSchemaType = {
        nodes: [{ id: 'node-1', template: 't', config: { some: 'config' } }],
        edges: [],
      };

      const template = createMockTemplate(NodeKind.Runtime);
      const mockHandle = createMockHandle({ instance: 'test' });
      vi.mocked(template.create).mockResolvedValue(mockHandle as any);
      vi.mocked(templateRegistry.getTemplate).mockReturnValue(template);

      const graph = createMockGraphEntity(schema, 'g1', 'G1', 'V1');
      await compiler.compile(graph);

      expect(template.create).toHaveBeenCalledWith();
      expect(mockHandle.provide).toHaveBeenCalledWith(
        expect.objectContaining({
          config: { some: 'config' },
          metadata: expect.objectContaining({
            graphId: 'g1',
            nodeId: 'node-1',
            version: 'V1',
          }),
        }),
      );
    });
  });

  describe('validation', () => {
    it('should validate unique node IDs', () => {
      const schema: GraphSchemaType = {
        nodes: [
          { id: 'n1', template: 't', config: {} },
          { id: 'n1', template: 't', config: {} },
        ],
        edges: [],
      };
      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
    });

    it('should validate edge references', () => {
      const schema: GraphSchemaType = {
        nodes: [{ id: 'n1', template: 't', config: {} }],
        edges: [{ from: 'n1', to: 'n2' }],
      };
      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
    });
  });
});
