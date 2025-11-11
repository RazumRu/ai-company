import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NodeBaseTemplate } from '../../graph-templates/templates/base-node.template';
import { DockerRuntime } from '../../runtime/services/docker-runtime';
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
  let mockGraphRegistry: GraphRegistry;
  let mockGraphStateManager: {
    registerNode: ReturnType<typeof vi.fn>;
    attachGraphNode: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };

  const createMockTemplate = (kind: NodeKind) => {
    let inputs: any[] = [];
    let outputs: any[] = [];

    if (kind === NodeKind.Tool) {
      inputs = [{ type: 'kind', value: NodeKind.SimpleAgent, multiple: true }];
      outputs = [{ type: 'kind', value: NodeKind.Runtime, multiple: false }];
    } else if (kind === NodeKind.SimpleAgent) {
      outputs = [{ type: 'kind', value: NodeKind.Tool, multiple: true }];
    } else if (kind === NodeKind.Runtime) {
      inputs = [{ type: 'kind', value: NodeKind.Tool, multiple: true }];
    } else if (kind === NodeKind.Resource) {
      inputs = [{ type: 'kind', value: NodeKind.Tool, multiple: false }];
    }

    return {
      name: `mock-${kind}`,
      description: `Mock ${kind} template`,
      kind,
      schema: z.object({}),
      inputs,
      outputs,
      create: vi.fn(),
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
            hasTemplate: vi.fn(),
            getTemplate: vi.fn(),
            validateTemplateConfig: vi.fn(),
          },
        },
        {
          provide: GraphStateFactory,
          useValue: {
            create: vi.fn().mockResolvedValue(mockGraphStateManager),
          },
        },
        {
          provide: GraphRegistry,
          useValue: {
            register: vi.fn(),
            unregister: vi.fn(),
            get: vi.fn(),
            getNode: vi.fn(),
            addNode: vi.fn(),
            deleteNode: vi.fn(),
          },
        },
      ],
    }).compile();

    compiler = module.get<GraphCompiler>(GraphCompiler);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
    mockGraphRegistry = module.get<GraphRegistry>(GraphRegistry);
    vi.clearAllMocks();
  });

  describe('compile', () => {
    it('should compile a valid graph schema with single runtime', async () => {
      const schema: GraphSchemaType = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
        ],
        edges: [],
      };

      const mockTemplate = createMockTemplate(NodeKind.Runtime);
      vi.mocked(mockTemplate.create).mockResolvedValue({
        container: 'runtime-instance',
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue(
        schema.nodes[0]!.config,
      );

      const entity = createMockGraphEntity(schema);
      const result = await compiler.compile(entity);

      expect(result.nodes.size).toBe(1);
      expect(result.nodes.get('runtime-1')).toEqual({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: schema.nodes[0]!.config,
        instance: { container: 'runtime-instance' },
      });
      expect(result.edges).toEqual([]);
      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        expect.objectContaining({
          name: 'Test Graph',
          version: '1.0.0',
          nodeId: 'runtime-1',
        }),
      );
    });

    it('should compile graph with runtime and tool', async () => {
      const schema = {
        nodes: [
          {
            id: 'python-runtime',
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'shell-tool',
            template: 'shell-tool',
            config: { runtimeNodeId: 'python-runtime' },
          },
        ],
        edges: [{ from: 'shell-tool', to: 'python-runtime' }],
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);

      vi.mocked(runtimeTemplate.create).mockResolvedValue({ exec: vi.fn() });
      vi.mocked(toolTemplate.create).mockResolvedValue({
        name: 'shell',
        build: vi.fn(),
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        return undefined;
      }) as any);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const entity = createMockGraphEntity(schema);
      const result = await compiler.compile(entity);

      expect(result.nodes.size).toBe(2);
      expect(result.nodes.get('python-runtime')).toBeDefined();
      expect(result.nodes.get('shell-tool')).toBeDefined();
      expect(result.edges).toEqual([
        { from: 'shell-tool', to: 'python-runtime' },
      ]);

      const runtimeCallOrder = vi.mocked(runtimeTemplate.create).mock
        .invocationCallOrder[0];
      const toolCallOrder = vi.mocked(toolTemplate.create).mock
        .invocationCallOrder[0];
      expect(runtimeCallOrder).toBeDefined();
      expect(toolCallOrder).toBeDefined();
      expect(runtimeCallOrder!).toBeLessThan(toolCallOrder!);
    });

    it('should compile complex graph with multiple runtimes, tools, and agents', async () => {
      const schema = {
        nodes: [
          {
            id: 'python-runtime',
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'node-runtime',
            template: 'docker-runtime',
            config: { image: 'node:20' },
          },
          {
            id: 'python-shell',
            template: 'shell-tool',
            config: { runtimeNodeId: 'python-runtime' },
          },
          {
            id: 'node-shell',
            template: 'shell-tool',
            config: { runtimeNodeId: 'node-runtime' },
          },
          {
            id: 'web-search',
            template: 'web-search-tool',
            config: {},
          },
          {
            id: 'python-agent',
            template: 'simple-agent',
            config: {
              name: 'Python Developer',
              instructions: 'You are a Python expert',
              toolNodeIds: ['python-shell', 'web-search'],
            },
          },
          {
            id: 'node-agent',
            template: 'simple-agent',
            config: {
              name: 'Node Developer',
              instructions: 'You are a Node.js expert',
              toolNodeIds: ['node-shell'],
            },
          },
        ],
        edges: [
          { from: 'python-shell', to: 'python-runtime' },
          { from: 'node-shell', to: 'node-runtime' },
          { from: 'python-agent', to: 'python-shell' },
          { from: 'python-agent', to: 'web-search' },
          { from: 'node-agent', to: 'node-shell' },
        ],
        metadata: {
          graphId: 'test-graph',
          name: 'Multi-Agent Development System',
          description: 'Python and Node.js development agents',
          version: '1.0.0',
        },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);
      const agentTemplate = createMockTemplate(NodeKind.SimpleAgent);

      vi.mocked(runtimeTemplate.create).mockResolvedValue({ exec: vi.fn() });
      vi.mocked(toolTemplate.create).mockResolvedValue({
        name: 'tool',
        build: vi.fn(),
      });
      vi.mocked(agentTemplate.create).mockResolvedValue({
        run: vi.fn(),
        addTool: vi.fn(),
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        if (name === 'web-search-tool') return toolTemplate;
        if (name === 'simple-agent') return agentTemplate;
        return undefined;
      }) as any);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const entity = createMockGraphEntity(schema);
      const result = await compiler.compile(entity);

      expect(result.nodes.size).toBe(7);
      expect(result.nodes.get('python-runtime')).toBeDefined();
      expect(result.nodes.get('node-runtime')).toBeDefined();
      expect(result.nodes.get('python-shell')).toBeDefined();
      expect(result.nodes.get('node-shell')).toBeDefined();
      expect(result.nodes.get('web-search')).toBeDefined();
      expect(result.nodes.get('python-agent')).toBeDefined();
      expect(result.nodes.get('node-agent')).toBeDefined();

      expect(result.edges).toHaveLength(5);

      expect(agentTemplate.create).toHaveBeenCalledTimes(2);
      expect(toolTemplate.create).toHaveBeenCalledTimes(3);
      expect(runtimeTemplate.create).toHaveBeenCalledTimes(2);
    });

    it('should validate unique node IDs', async () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test-template',
            config: {},
          },
          {
            id: 'node-1',
            template: 'test-template',
            config: {},
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      const entity = createMockGraphEntity(schema);
      await expect(compiler.compile(entity)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate edge references', async () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test-template',
            config: {},
          },
        ],
        edges: [{ from: 'node-1', to: 'non-existent-node' }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      const entity = createMockGraphEntity(schema);
      await expect(compiler.compile(entity)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should validate template registration', async () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'unregistered-template',
            config: {},
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(false);

      const entity = createMockGraphEntity(schema);
      await expect(compiler.compile(entity)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should build nodes in correct dependency order', async () => {
      const schema = {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: { name: 'Test Agent', toolNodeIds: ['tool-1'] },
          },
          {
            id: 'tool-1',
            template: 'shell-tool',
            config: { runtimeNodeId: 'runtime-1' },
          },
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
        ],
        edges: [
          { from: 'agent-1', to: 'tool-1' },
          { from: 'tool-1', to: 'runtime-1' },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);
      const agentTemplate = createMockTemplate(NodeKind.SimpleAgent);

      const createOrder: string[] = [];

      vi.mocked(runtimeTemplate.create).mockImplementation(async () => {
        createOrder.push('runtime');
        return { exec: vi.fn() };
      });
      vi.mocked(toolTemplate.create).mockImplementation(async () => {
        createOrder.push('tool');
        return { name: 'shell' };
      });
      vi.mocked(agentTemplate.create).mockImplementation(async () => {
        createOrder.push('agent');
        return { run: vi.fn() };
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        if (name === 'simple-agent') return agentTemplate;
        return undefined;
      }) as any);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const entity = createMockGraphEntity(schema);
      await compiler.compile(entity);

      expect(createOrder).toEqual(['runtime', 'tool', 'agent']);
    });

    it('should handle empty graph', async () => {
      const schema = {
        nodes: [],
        edges: [],
      };

      const entity = createMockGraphEntity(schema);
      const result = await compiler.compile(entity);

      expect(result.nodes.size).toBe(0);
      expect(result.edges).toEqual([]);
    });

    it('should handle graph without edges', async () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test-template',
            config: {},
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const mockTemplate = createMockTemplate(NodeKind.Runtime);
      vi.mocked(mockTemplate.create).mockResolvedValue({ instance: 'test' });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      const entity = createMockGraphEntity(schema);
      const result = await compiler.compile(entity);

      expect(result.nodes.size).toBe(1);
      expect(result.edges).toEqual([]);
    });

    it('should pass compiled nodes to template create method', async () => {
      const schema = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-1',
            to: 'runtime-1',
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);

      vi.mocked(runtimeTemplate.create).mockResolvedValue({ exec: vi.fn() });
      vi.mocked(toolTemplate.create).mockResolvedValue({ name: 'shell' });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        return undefined;
      }) as any);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const entity = createMockGraphEntity(schema);
      await compiler.compile(entity);

      expect(runtimeTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ image: 'python:3.11' }),
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        expect.objectContaining({
          nodeId: 'runtime-1',
        }),
      );

      expect(runtimeTemplate.create).toHaveBeenCalled();
      expect(toolTemplate.create).toHaveBeenCalled();

      const inputNodesArg = vi.mocked(runtimeTemplate.create).mock.calls[0]![1];
      const outputNodesArg = vi.mocked(runtimeTemplate.create).mock
        .calls[0]![2];
      expect(inputNodesArg.has('tool-1')).toBe(false);
      expect(outputNodesArg.has('tool-1')).toBe(false);
    });
  });

  describe('validateSchema', () => {
    it('should throw error for duplicate node IDs', () => {
      const schema = {
        nodes: [
          {
            id: 'duplicate',
            template: 'test',
            config: {},
          },
          {
            id: 'duplicate',
            template: 'test',
            config: {},
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        'GRAPH_DUPLICATE_NODE',
      );
    });

    it('should throw error for invalid edge source reference', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: {},
          },
        ],
        edges: [{ from: 'missing-node', to: 'node-1' }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        'Edge references non-existent source node: missing-node',
      );
    });

    it('should throw error for invalid edge target reference', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: {},
          },
        ],
        edges: [{ from: 'node-1', to: 'missing-node' }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        'Edge references non-existent target node: missing-node',
      );
    });

    it('should throw error for unregistered template', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'unregistered',
            config: {},
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(false);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        "Template 'unregistered' is not registered",
      );
    });

    it('should validate configuration for each node', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: { key: 'value' },
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const validateSpy = vi
        .spyOn(templateRegistry, 'validateTemplateConfig')
        .mockReturnValue({ key: 'value' });
      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);

      compiler.validateSchema(schema);

      expect(validateSpy).toHaveBeenCalledWith('test', { key: 'value' });
    });

    it('should pass validation for valid schema', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: { key: 'value' },
          },
          {
            id: 'node-2',
            template: 'test2',
            config: { key2: 'value2' },
          },
        ],
        edges: [{ from: 'node-1', to: 'node-2' }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should handle schema without edges', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: {},
          },
        ],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should throw error for invalid template configuration', () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'test',
            config: { invalid: 'config' },
          },
        ],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        () => {
          throw new BadRequestException(
            'INVALID_TEMPLATE_CONFIG',
            'Template configuration validation failed',
          );
        },
      );

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        'Template configuration validation failed',
      );
    });

    it('should validate edge-based connections', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {},
          },
          {
            id: 'resource-node',
            template: 'github-resource',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'resource-node',
          },
        ],
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        inputs: [{ type: 'kind', value: NodeKind.Tool, multiple: false }],
      };
      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        outputs: [{ type: 'kind', value: NodeKind.Resource, multiple: false }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') return mockToolTemplate;
        if (name === 'github-resource') return mockResourceTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should throw error for non-existent edge target', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'non-existent-resource',
          },
        ],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        'Edge references non-existent target node: non-existent-resource',
      );
    });

    it('should validate template connection restrictions based on inputs', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {},
          },
          {
            id: 'resource-node',
            template: 'forbidden-resource',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'resource-node',
          },
        ],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'shell-tool',
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'forbidden-resource',
        inputs: [
          { type: 'template', value: 'github-resource', multiple: true },
          { type: 'kind', value: NodeKind.Resource, multiple: true },
        ],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') return mockToolTemplate;
        if (name === 'forbidden-resource') return mockResourceTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
    });

    it('should allow connections when template restrictions are satisfied', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {},
          },
          {
            id: 'resource-node',
            template: 'github-resource',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'resource-node',
          },
        ],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'shell-tool',
        inputs: [
          { type: 'template', value: 'github-resource', multiple: true },
        ],
        outputs: [{ type: 'kind', value: NodeKind.Resource, multiple: false }],
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'github-resource',
        inputs: [{ type: 'kind', value: NodeKind.Tool, multiple: false }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') return mockToolTemplate;
        if (name === 'github-resource') return mockResourceTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should validate template connection restrictions based on inputs', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {
              runtimeNodeId: 'runtime-node',
              resourceNodeIds: ['resource-node'],
            },
          },
          {
            id: 'runtime-node',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'resource-node',
            template: 'forbidden-resource',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'resource-node',
          },
        ],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'shell-tool',
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'forbidden-resource',
        inputs: [
          { type: 'template', value: 'github-resource', multiple: true },
          { type: 'kind', value: NodeKind.Resource, multiple: true },
        ],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') return mockToolTemplate;
        if (name === 'forbidden-resource') return mockResourceTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
    });

    it('should validate template connection restrictions based on input kinds', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'restricted-tool',
            config: {},
          },
          {
            id: 'resource-node',
            template: 'some-resource',
            config: {},
          },
        ],
        edges: [
          {
            from: 'tool-node',
            to: 'resource-node',
          },
        ],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'restricted-tool',
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'some-resource',
        inputs: [{ type: 'kind', value: NodeKind.Resource, multiple: true }],
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'restricted-tool') return mockToolTemplate;
        if (name === 'some-resource') return mockResourceTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
    });

    it('should allow connections when template restrictions are satisfied', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'shell-tool',
            config: {
              runtimeNodeId: 'runtime-node',
              resourceNodeIds: ['resource-node'],
            },
          },
          {
            id: 'runtime-node',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'resource-node',
            template: 'github-resource',
            config: {},
          },
        ],
        edges: [],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'shell-tool',
        inputs: [
          { type: 'template', value: 'github-resource', multiple: true },
        ],
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'github-resource',
      };

      const mockRuntimeTemplate = {
        ...createMockTemplate(NodeKind.Runtime),
        name: 'docker-runtime',
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') return mockToolTemplate;
        if (name === 'github-resource') return mockResourceTemplate;
        if (name === 'docker-runtime') return mockRuntimeTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should allow connections when no restrictions are defined', () => {
      const schema = {
        nodes: [
          {
            id: 'tool-node',
            template: 'unrestricted-tool',
            config: {
              runtimeNodeId: 'runtime-node',
              resourceNodeIds: ['resource-node'],
            },
          },
          {
            id: 'runtime-node',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'resource-node',
            template: 'any-resource',
            config: {},
          },
        ],
        edges: [],
      };

      const mockToolTemplate = {
        ...createMockTemplate(NodeKind.Tool),
        name: 'unrestricted-tool',
      };

      const mockResourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'any-resource',
      };

      const mockRuntimeTemplate = {
        ...createMockTemplate(NodeKind.Runtime),
        name: 'docker-runtime',
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'unrestricted-tool') return mockToolTemplate;
        if (name === 'any-resource') return mockResourceTemplate;
        if (name === 'docker-runtime') return mockRuntimeTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should validate template output restrictions based on outputs', () => {
      const schema = {
        nodes: [
          {
            id: 'source-node',
            template: 'restricted-source',
            config: {},
          },
          {
            id: 'target-node',
            template: 'forbidden-target',
            config: {},
          },
        ],
        edges: [
          {
            from: 'source-node',
            to: 'target-node',
          },
        ],
      };

      const mockSourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'restricted-source',
        outputs: [
          { type: 'template', value: 'allowed-target', multiple: true },
        ],
      };

      const mockTargetTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'forbidden-target',
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'restricted-source') return mockSourceTemplate;
        if (name === 'forbidden-target') return mockTargetTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        "Template 'restricted-source' only provides to [template:allowed-target], but trying to connect to 'forbidden-target' (kind: resource)",
      );
    });

    it('should validate template output restrictions with empty outputs', () => {
      const schema = {
        nodes: [
          {
            id: 'source-node',
            template: 'no-output-source',
            config: {},
          },
          {
            id: 'target-node',
            template: 'any-target',
            config: {},
          },
        ],
        edges: [
          {
            from: 'source-node',
            to: 'target-node',
          },
        ],
      };

      const mockSourceTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'no-output-source',
        outputs: [],
      };

      const mockTargetTemplate = {
        ...createMockTemplate(NodeKind.Resource),
        name: 'any-target',
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(((
        name: string,
      ) => {
        if (name === 'no-output-source') return mockSourceTemplate;
        if (name === 'any-target') return mockTargetTemplate;
        return undefined;
      }) as any);

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        "Template 'no-output-source' does not provide any connections (outputs is empty), but trying to connect to 'any-target' (kind: resource)",
      );
    });
  });

  describe('Metadata Propagation', () => {
    it('should pass metadata with nodeId to template.create', async () => {
      const mockTemplate = {
        name: 'mock-template',
        description: 'Mock template',
        schema: z.object({}),
        kind: NodeKind.SimpleAgent,
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'mock-instance' }),
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const schema = {
        nodes: [
          {
            id: 'test-node-456',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 100,
              instructions: 'You are a helpful assistant',
              name: 'test-agent',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
      };

      const entity = createMockGraphEntity(
        schema,
        'test-graph-123',
        'Test Graph',
        '1.0.0',
      );
      await compiler.compile(entity);

      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'test-node-456',
          temporary: false,
        },
      );
    });

    it('should pass different nodeId for different nodes', async () => {
      const mockTemplate1 = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent',
        description: 'Mock template 1',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'mock-instance-1' }),
      };
      const mockTemplate2 = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent-2',
        description: 'Mock template 2',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'mock-instance-2' }),
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(
        (templateName) => {
          if (templateName === 'simple-agent') {
            return mockTemplate1;
          }
          if (templateName === 'simple-agent-2') {
            return mockTemplate2;
          }
          return mockTemplate1; // fallback
        },
      );
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const schema = {
        nodes: [
          {
            id: 'node-1',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 100,
              instructions: 'Assistant 1',
              name: 'agent-1',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
          {
            id: 'node-2',
            template: 'simple-agent-2',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 100,
              instructions: 'Assistant 2',
              name: 'agent-2',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
      };

      const entity = createMockGraphEntity(
        schema,
        'test-graph-123',
        'Test Graph',
        '1.0.0',
      );
      await compiler.compile(entity);

      expect(mockTemplate1.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'node-1',
          temporary: false,
        },
      );

      expect(mockTemplate2.create).toHaveBeenCalledWith(
        schema.nodes[1]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'node-2',
          temporary: false,
        },
      );
    });

    it('should preserve all metadata properties', async () => {
      const mockTemplate = {
        name: 'mock-template',
        description: 'Mock template',
        schema: z.object({}),
        kind: NodeKind.SimpleAgent,
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'mock-instance' }),
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const extendedMetadata = {
        graphId: 'test-graph-123',
        version: '1.0.0',
        customProperty: 'custom-value',
        anotherProperty: 123,
      };

      const schema = {
        nodes: [
          {
            id: 'test-node-456',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 100,
              instructions: 'You are a helpful assistant',
              name: 'test-agent',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
        metadata: extendedMetadata,
      };

      const entity = createMockGraphEntity(schema);
      await compiler.compile(entity, extendedMetadata);

      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          ...extendedMetadata,
          nodeId: 'test-node-456',
          temporary: false,
        },
      );
    });

    it('should handle different node templates', async () => {
      const mockAgentTemplate = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent',
        description: 'Agent template',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'agent-instance' }),
      };
      const mockToolTemplate = {
        kind: NodeKind.Tool,
        name: 'web-search-tool',
        description: 'Tool template',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'tool-instance' }),
      };
      const mockRuntimeTemplate = {
        kind: NodeKind.Runtime,
        name: 'docker-runtime',
        description: 'Runtime template',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'runtime-instance' }),
      };
      const mockTriggerTemplate = {
        kind: NodeKind.Trigger,
        name: 'manual-trigger',
        description: 'Trigger template',
        schema: z.object({}),
        inputs: [],
        outputs: [],
        create: vi.fn().mockResolvedValue({ instance: 'trigger-instance' }),
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation(
        (templateName) => {
          if (templateName === 'simple-agent') return mockAgentTemplate;
          if (templateName === 'web-search-tool') return mockToolTemplate;
          if (templateName === 'docker-runtime') return mockRuntimeTemplate;
          if (templateName === 'manual-trigger') return mockTriggerTemplate;
          return mockAgentTemplate; // fallback
        },
      );
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const schema = {
        nodes: [
          {
            id: 'agent-node',
            template: 'simple-agent',
            config: {
              summarizeMaxTokens: 1000,
              summarizeKeepTokens: 100,
              instructions: 'Agent',
              name: 'agent',
              invokeModelName: 'gpt-5-mini',
              toolNodeIds: [],
            },
          },
          {
            id: 'tool-node',
            template: 'web-search-tool',
            config: {},
          },
          {
            id: 'runtime-node',
            template: 'docker-runtime',
            config: { image: 'python:3.9' },
          },
          {
            id: 'trigger-node',
            template: 'manual-trigger',
            config: {},
          },
        ],
        edges: [],
      };

      const entity = createMockGraphEntity(
        schema,
        'test-graph-123',
        'Test Graph',
        '1.0.0',
      );
      await compiler.compile(entity);

      expect(mockAgentTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'agent-node',
          temporary: false,
        },
      );

      expect(mockToolTemplate.create).toHaveBeenCalledWith(
        schema.nodes[1]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'tool-node',
          temporary: false,
        },
      );

      expect(mockRuntimeTemplate.create).toHaveBeenCalledWith(
        schema.nodes[2]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'runtime-node',
          temporary: false,
        },
      );

      expect(mockTriggerTemplate.create).toHaveBeenCalledWith(
        schema.nodes[3]!.config,
        expect.any(Set), // inputNodeIds
        expect.any(Set), // outputNodeIds
        {
          name: 'Test Graph',
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'trigger-node',
          temporary: false,
        },
      );
    });
  });

  describe('destroyNotCompiledGraph', () => {
    it('should destroy runtime containers for graphs with docker-runtime nodes', async () => {
      const graphWithRuntime = createMockGraphEntity({
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'node:20',
            },
          },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              instructions: 'Test instructions',
              invokeModelName: 'gpt-5-mini',
            },
          },
        ],
        edges: [],
      });

      await compiler.destroyNotCompiledGraph(graphWithRuntime);

      expect(vi.mocked(DockerRuntime.cleanupByLabels)).toHaveBeenCalledWith(
        { 'ai-company/graph_id': graphWithRuntime.id },
        expect.objectContaining({ socketPath: expect.any(String) }),
      );
    });

    it('should do nothing for graphs without docker-runtime nodes', async () => {
      const graphWithoutRuntime = createMockGraphEntity({
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              instructions: 'Test instructions',
              invokeModelName: 'gpt-5-mini',
            },
          },
        ],
        edges: [],
      });

      // Mock the DockerRuntime import
      const mockDockerRuntime = {
        cleanupByLabels: vi.fn().mockResolvedValue(undefined),
      };
      vi.doMock('../../runtime/services/docker-runtime', () => ({
        DockerRuntime: mockDockerRuntime,
      }));

      await compiler.destroyNotCompiledGraph(graphWithoutRuntime);

      expect(mockDockerRuntime.cleanupByLabels).not.toHaveBeenCalled();
    });

    it('should handle multiple docker-runtime nodes', async () => {
      const graphWithMultipleRuntimes = createMockGraphEntity({
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'node:20',
            },
          },
          {
            id: 'runtime-2',
            template: 'docker-runtime',
            config: {
              runtimeType: 'Docker',
              image: 'python:3.11',
            },
          },
        ],
        edges: [],
      });

      await compiler.destroyNotCompiledGraph(graphWithMultipleRuntimes);

      expect(vi.mocked(DockerRuntime.cleanupByLabels)).toHaveBeenCalledWith(
        { 'ai-company/graph_id': graphWithMultipleRuntimes.id },
        expect.objectContaining({ socketPath: expect.any(String) }),
      );
    });
  });

  describe('validateRequiredConnections', () => {
    beforeEach(() => {
      // Reset mocks before each test
      vi.clearAllMocks();
    });

    it('should pass validation when required connections are present', () => {
      const schema = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'github-resource-1',
            template: 'github-resource',
            config: { patToken: 'test-token', auth: false },
          },
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [
          {
            from: 'shell-tool-1',
            to: 'runtime-1',
          },
          {
            from: 'shell-tool-1',
            to: 'github-resource-1',
          },
        ],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') {
          return {
            name: 'shell-tool',
            kind: NodeKind.Tool,
            description: 'Shell tool',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.SimpleAgent,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'template',
                value: 'github-resource',
                required: true,
                multiple: true,
              },
              {
                type: 'kind',
                value: NodeKind.Runtime,
                required: true,
                multiple: false,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'docker-runtime') {
          return {
            name: 'docker-runtime',
            kind: NodeKind.Runtime,
            description: 'Docker runtime',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['shell-tool', 'docker-runtime', 'github-resource'].includes(
          name,
        );
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should throw error when required connections are missing', () => {
      const schema = {
        nodes: [
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') {
          return {
            name: 'shell-tool',
            kind: NodeKind.Tool,
            description: 'Shell tool',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.SimpleAgent,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'template',
                value: 'github-resource',
                required: true,
                multiple: true,
              },
              {
                type: 'kind',
                value: NodeKind.Runtime,
                required: true,
                multiple: false,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['shell-tool'].includes(name);
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        "Template 'shell-tool' requires at least one connection to template 'github-resource', but none found",
      );
    });

    it('should pass validation when multiple required connections are satisfied', () => {
      const schema = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'github-resource-1',
            template: 'github-resource',
            config: { patToken: 'test-token', auth: false },
          },
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [
          {
            from: 'shell-tool-1',
            to: 'runtime-1',
          },
          {
            from: 'shell-tool-1',
            to: 'github-resource-1',
          },
        ],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') {
          return {
            name: 'shell-tool',
            kind: NodeKind.Tool,
            description: 'Shell tool',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.SimpleAgent,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'template',
                value: 'github-resource',
                required: true,
                multiple: true,
              },
              {
                type: 'kind',
                value: NodeKind.Runtime,
                required: true,
                multiple: false,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'docker-runtime') {
          return {
            name: 'docker-runtime',
            kind: NodeKind.Runtime,
            description: 'Docker runtime',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['shell-tool', 'docker-runtime', 'github-resource'].includes(
          name,
        );
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should throw error when one of multiple required connections is missing', () => {
      const schema = {
        nodes: [
          {
            id: 'runtime-1',
            template: 'docker-runtime',
            config: { runtimeType: 'Docker' },
          },
          {
            id: 'shell-tool-1',
            template: 'shell-tool',
            config: {},
          },
        ],
        edges: [
          {
            from: 'shell-tool-1',
            to: 'runtime-1',
          },
        ],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'shell-tool') {
          return {
            name: 'shell-tool',
            kind: NodeKind.Tool,
            description: 'Shell tool',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.SimpleAgent,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'template',
                value: 'github-resource',
                required: true,
                multiple: true,
              },
              {
                type: 'kind',
                value: NodeKind.Runtime,
                required: true,
                multiple: false,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'docker-runtime') {
          return {
            name: 'docker-runtime',
            kind: NodeKind.Runtime,
            description: 'Docker runtime',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['shell-tool', 'docker-runtime'].includes(name);
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).toThrow(
        BadRequestException,
      );
      expect(() => compiler.validateSchema(schema)).toThrow(
        "Template 'shell-tool' requires at least one connection to template 'github-resource', but none found",
      );
    });

    it('should pass validation when template has no required connections', () => {
      const schema = {
        nodes: [
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Test Agent',
              instructions: 'Test instructions',
              invokeModelName: 'gpt-5-mini',
            },
          },
        ],
        edges: [],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'simple-agent') {
          return {
            name: 'simple-agent',
            kind: NodeKind.SimpleAgent,
            description: 'Simple agent',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                required: false,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['simple-agent'].includes(name);
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });

    it('should pass validation when template has empty inputs', () => {
      const schema = {
        nodes: [
          {
            id: 'web-search-tool-1',
            template: 'web-search-tool',
            config: {},
          },
        ],
        edges: [],
      };

      vi.mocked(templateRegistry.getTemplate).mockImplementation(((
        name: string,
      ) => {
        if (name === 'web-search-tool') {
          return {
            name: 'web-search-tool',
            kind: NodeKind.Tool,
            description: 'Web search tool',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        if (name === 'github-resource') {
          return {
            name: 'github-resource',
            kind: NodeKind.Resource,
            description: 'GitHub resource',
            schema: z.object({}),
            inputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            outputs: [
              {
                type: 'kind',
                value: NodeKind.Tool,
                multiple: true,
              },
            ],
            create: vi.fn(),
          };
        }
        return undefined;
      }) as any);

      vi.mocked(templateRegistry.hasTemplate).mockImplementation((name) => {
        return ['web-search-tool'].includes(name);
      });

      vi.mocked(templateRegistry.validateTemplateConfig).mockImplementation(
        () => {},
      );

      expect(() => compiler.validateSchema(schema)).not.toThrow();
    });
  });
});
