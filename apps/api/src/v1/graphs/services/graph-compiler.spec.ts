import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { GraphSchemaType, NodeKind } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';

describe('GraphCompiler', () => {
  let compiler: GraphCompiler;
  let templateRegistry: TemplateRegistry;

  const createMockTemplate = (kind: NodeKind): any => ({
    name: `mock-${kind}`,
    description: `Mock ${kind} template`,
    kind,
    schema: { parse: vi.fn((config) => config) },
    create: vi.fn(),
  });

  beforeEach(async () => {
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
          provide: NotificationsService,
          useValue: {
            emit: vi.fn(),
          },
        },
      ],
    }).compile();

    compiler = module.get<GraphCompiler>(GraphCompiler);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
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
        metadata: {
          graphId: 'test-graph',
          name: 'Test Graph',
          version: '1.0.0',
        },
      };

      const mockTemplate = createMockTemplate(NodeKind.Runtime);
      mockTemplate.create.mockResolvedValue({ container: 'runtime-instance' });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue(
        schema.nodes[0]!.config,
      );

      const result = await compiler.compile(schema);

      expect(result.nodes.size).toBe(1);
      expect(result.nodes.get('runtime-1')).toEqual({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        instance: { container: 'runtime-instance' },
      });
      expect(result.edges).toEqual([]);
      // Metadata is no longer returned in CompiledGraph
      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
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
        edges: [{ from: 'python-runtime', to: 'shell-tool' }],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);

      runtimeTemplate.create.mockResolvedValue({ exec: vi.fn() });
      toolTemplate.create.mockResolvedValue({ name: 'shell', build: vi.fn() });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation((name) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        return undefined;
      });
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const result = await compiler.compile(schema);

      expect(result.nodes.size).toBe(2);
      expect(result.nodes.get('python-runtime')).toBeDefined();
      expect(result.nodes.get('shell-tool')).toBeDefined();
      expect(result.edges).toEqual([
        { from: 'python-runtime', to: 'shell-tool' },
      ]);

      // Verify runtime was created before tool
      expect(runtimeTemplate.create).toHaveBeenCalledBefore(
        toolTemplate.create,
      );
    });

    it('should compile complex graph with multiple runtimes, tools, and agents', async () => {
      const schema = {
        nodes: [
          // Runtimes
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
          // Tools
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
          // Agents
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
          { from: 'python-runtime', to: 'python-shell' },
          { from: 'node-runtime', to: 'node-shell' },
          { from: 'python-shell', to: 'python-agent' },
          { from: 'web-search', to: 'python-agent' },
          { from: 'node-shell', to: 'node-agent' },
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

      runtimeTemplate.create.mockResolvedValue({ exec: vi.fn() });
      toolTemplate.create.mockResolvedValue({ name: 'tool', build: vi.fn() });
      agentTemplate.create.mockResolvedValue({
        run: vi.fn(),
        addTool: vi.fn(),
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation((name) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        if (name === 'web-search-tool') return toolTemplate;
        if (name === 'simple-agent') return agentTemplate;
        return undefined;
      });
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      const result = await compiler.compile(schema);

      // Verify all nodes were created
      expect(result.nodes.size).toBe(7);
      expect(result.nodes.get('python-runtime')).toBeDefined();
      expect(result.nodes.get('node-runtime')).toBeDefined();
      expect(result.nodes.get('python-shell')).toBeDefined();
      expect(result.nodes.get('node-shell')).toBeDefined();
      expect(result.nodes.get('web-search')).toBeDefined();
      expect(result.nodes.get('python-agent')).toBeDefined();
      expect(result.nodes.get('node-agent')).toBeDefined();

      // Verify edges
      expect(result.edges).toHaveLength(5);
      // Metadata is no longer returned in CompiledGraph

      // Verify creation order: runtimes first, then tools, then agents
      expect(runtimeTemplate.create).toHaveBeenCalledTimes(2);
      expect(toolTemplate.create).toHaveBeenCalledTimes(3);
      expect(agentTemplate.create).toHaveBeenCalledTimes(2);
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

      await expect(compiler.compile(schema)).rejects.toThrow(
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
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      await expect(compiler.compile(schema)).rejects.toThrow(
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

      await expect(compiler.compile(schema)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should build nodes in correct dependency order', async () => {
      const schema = {
        nodes: [
          // Defined in reverse order to test sorting
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
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);
      const agentTemplate = createMockTemplate(NodeKind.SimpleAgent);

      const createOrder: string[] = [];

      runtimeTemplate.create.mockImplementation(async () => {
        createOrder.push('runtime');
        return { exec: vi.fn() };
      });
      toolTemplate.create.mockImplementation(async () => {
        createOrder.push('tool');
        return { name: 'shell' };
      });
      agentTemplate.create.mockImplementation(async () => {
        createOrder.push('agent');
        return { run: vi.fn() };
      });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation((name) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        if (name === 'simple-agent') return agentTemplate;
        return undefined;
      });
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      await compiler.compile(schema);

      // Verify creation order: runtime -> tool -> agent
      expect(createOrder).toEqual(['runtime', 'tool', 'agent']);
    });

    it('should handle empty graph', async () => {
      const schema = {
        nodes: [],
        edges: [],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const result = await compiler.compile(schema);

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
      mockTemplate.create.mockResolvedValue({ instance: 'test' });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockReturnValue(mockTemplate);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      const result = await compiler.compile(schema);

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
            config: { runtimeNodeId: 'runtime-1' },
          },
        ],
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      const runtimeTemplate = createMockTemplate(NodeKind.Runtime);
      const toolTemplate = createMockTemplate(NodeKind.Tool);

      runtimeTemplate.create.mockResolvedValue({ exec: vi.fn() });
      toolTemplate.create.mockResolvedValue({ name: 'shell' });

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'getTemplate').mockImplementation((name) => {
        if (name === 'docker-runtime') return runtimeTemplate;
        if (name === 'shell-tool') return toolTemplate;
        return undefined;
      });
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockImplementation(
        (_, config) => config,
      );

      await compiler.compile(schema);

      // Verify tool create was called with compiled nodes map containing runtime
      expect(toolTemplate.create).toHaveBeenCalledWith(
        { runtimeNodeId: 'runtime-1' },
        expect.any(Map),
        expect.objectContaining({
          nodeId: 'tool-1',
        }),
      );

      const compiledNodesArg = toolTemplate.create.mock.calls[0]![1];
      expect(compiledNodesArg.has('runtime-1')).toBe(true);
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

      expect(() => compiler['validateSchema'](schema)).toThrow(
        BadRequestException,
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
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler['validateSchema'](schema)).toThrow(
        BadRequestException,
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
        metadata: { graphId: 'test-graph', version: '1.0.0' },
      };

      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);
      vi.spyOn(templateRegistry, 'validateTemplateConfig').mockReturnValue({});

      expect(() => compiler['validateSchema'](schema)).toThrow(
        BadRequestException,
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

      expect(() => compiler['validateSchema'](schema)).toThrow(
        BadRequestException,
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

      compiler['validateSchema'](schema);

      expect(validateSpy).toHaveBeenCalledWith('test', { key: 'value' });
    });
  });

  describe('Metadata Propagation', () => {
    it('should pass metadata with nodeId to template.create', async () => {
      const mockTemplate = {
        name: 'mock-template',
        description: 'Mock template',
        schema: {} as any,
        kind: NodeKind.SimpleAgent,
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
              invokeModelName: 'gpt-4',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
        metadata: { graphId: 'test-graph-123', version: '1.0.0' },
      };

      await compiler.compile(schema);

      // Verify that template.create was called with the correct metadata
      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
        {
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'test-node-456',
        },
      );
    });

    it('should pass different nodeId for different nodes', async () => {
      const mockTemplate1 = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent',
        description: 'Mock template 1',
        schema: {} as any,
        create: vi.fn().mockResolvedValue({ instance: 'mock-instance-1' }),
      };
      const mockTemplate2 = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent-2',
        description: 'Mock template 2',
        schema: {} as any,
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
              invokeModelName: 'gpt-4',
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
              invokeModelName: 'gpt-4',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
        metadata: { graphId: 'test-graph-123', version: '1.0.0' },
      };

      await compiler.compile(schema);

      // Verify that each template received the correct nodeId
      expect(mockTemplate1.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
        {
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'node-1',
        },
      );

      expect(mockTemplate2.create).toHaveBeenCalledWith(
        schema.nodes[1]!.config,
        expect.any(Map),
        {
          graphId: 'test-graph-123',
          version: '1.0.0',
          nodeId: 'node-2',
        },
      );
    });

    it('should preserve all metadata properties', async () => {
      const mockTemplate = {
        name: 'mock-template',
        description: 'Mock template',
        schema: {} as any,
        kind: NodeKind.SimpleAgent,
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
              invokeModelName: 'gpt-4',
              toolNodeIds: [],
            },
          },
        ],
        edges: [],
        metadata: extendedMetadata,
      };

      await compiler.compile(schema);

      // Verify that all metadata properties are preserved
      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
        {
          ...extendedMetadata,
          nodeId: 'test-node-456',
        },
      );
    });

    it('should handle different node templates', async () => {
      const mockAgentTemplate = {
        kind: NodeKind.SimpleAgent,
        name: 'simple-agent',
        description: 'Agent template',
        schema: {} as any,
        create: vi.fn().mockResolvedValue({ instance: 'agent-instance' }),
      };
      const mockToolTemplate = {
        kind: NodeKind.Tool,
        name: 'web-search-tool',
        description: 'Tool template',
        schema: {} as any,
        create: vi.fn().mockResolvedValue({ instance: 'tool-instance' }),
      };
      const mockRuntimeTemplate = {
        kind: NodeKind.Runtime,
        name: 'docker-runtime',
        description: 'Runtime template',
        schema: {} as any,
        create: vi.fn().mockResolvedValue({ instance: 'runtime-instance' }),
      };
      const mockTriggerTemplate = {
        kind: NodeKind.Trigger,
        name: 'manual-trigger',
        description: 'Trigger template',
        schema: {} as any,
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
              invokeModelName: 'gpt-4',
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
            config: { agentId: 'agent-node' },
          },
        ],
        edges: [],
        metadata: { graphId: 'test-graph-123', version: '1.0.0' },
      };

      await compiler.compile(schema);

      // Verify that each template received the correct metadata
      expect(mockAgentTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
        { graphId: 'test-graph-123', version: '1.0.0', nodeId: 'agent-node' },
      );

      expect(mockToolTemplate.create).toHaveBeenCalledWith(
        schema.nodes[1]!.config,
        expect.any(Map),
        { graphId: 'test-graph-123', version: '1.0.0', nodeId: 'tool-node' },
      );

      expect(mockRuntimeTemplate.create).toHaveBeenCalledWith(
        schema.nodes[2]!.config,
        expect.any(Map),
        { graphId: 'test-graph-123', version: '1.0.0', nodeId: 'runtime-node' },
      );

      expect(mockTriggerTemplate.create).toHaveBeenCalledWith(
        schema.nodes[3]!.config,
        expect.any(Map),
        { graphId: 'test-graph-123', version: '1.0.0', nodeId: 'trigger-node' },
      );
    });
  });
});
