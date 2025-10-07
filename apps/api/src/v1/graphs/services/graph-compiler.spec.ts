import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateRegistry } from '../../graph-templates/services/template-registry';
import { NodeKind } from '../graphs.types';
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
      ],
    }).compile();

    compiler = module.get<GraphCompiler>(GraphCompiler);
    templateRegistry = module.get<TemplateRegistry>(TemplateRegistry);
  });

  describe('compile', () => {
    it('should compile a valid graph schema with single runtime', async () => {
      const schema = {
        nodes: [
          {
            id: 'runtime-1',
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
        ],
        edges: [],
        metadata: { name: 'Test Graph', version: '1.0.0' },
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
      expect(result.metadata).toEqual({
        name: 'Test Graph',
        version: '1.0.0',
      });
      expect(mockTemplate.create).toHaveBeenCalledWith(
        schema.nodes[0]!.config,
        expect.any(Map),
      );
    });

    it('should compile graph with runtime and tool', async () => {
      const schema = {
        nodes: [
          {
            id: 'python-runtime',
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'shell-tool',
            kind: NodeKind.Tool,
            template: 'shell-tool',
            config: { runtimeNodeId: 'python-runtime' },
          },
        ],
        edges: [{ from: 'python-runtime', to: 'shell-tool' }],
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
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'node-runtime',
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'node:20' },
          },
          // Tools
          {
            id: 'python-shell',
            kind: NodeKind.Tool,
            template: 'shell-tool',
            config: { runtimeNodeId: 'python-runtime' },
          },
          {
            id: 'node-shell',
            kind: NodeKind.Tool,
            template: 'shell-tool',
            config: { runtimeNodeId: 'node-runtime' },
          },
          {
            id: 'web-search',
            kind: NodeKind.Tool,
            template: 'web-search-tool',
            config: {},
          },
          // Agents
          {
            id: 'python-agent',
            kind: NodeKind.SimpleAgent,
            template: 'simple-agent',
            config: {
              name: 'Python Developer',
              instructions: 'You are a Python expert',
              toolNodeIds: ['python-shell', 'web-search'],
            },
          },
          {
            id: 'node-agent',
            kind: NodeKind.SimpleAgent,
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
          name: 'Multi-Agent Development System',
          description: 'Python and Node.js development agents',
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
      expect(result.metadata?.name).toBe('Multi-Agent Development System');

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
            kind: NodeKind.Runtime,
            template: 'test-template',
            config: {},
          },
          {
            id: 'node-1',
            kind: NodeKind.Runtime,
            template: 'test-template',
            config: {},
          },
        ],
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
            kind: NodeKind.Runtime,
            template: 'test-template',
            config: {},
          },
        ],
        edges: [{ from: 'node-1', to: 'non-existent-node' }],
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
            kind: NodeKind.Runtime,
            template: 'unregistered-template',
            config: {},
          },
        ],
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
            kind: NodeKind.SimpleAgent,
            template: 'simple-agent',
            config: { name: 'Test Agent', toolNodeIds: ['tool-1'] },
          },
          {
            id: 'tool-1',
            kind: NodeKind.Tool,
            template: 'shell-tool',
            config: { runtimeNodeId: 'runtime-1' },
          },
          {
            id: 'runtime-1',
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
        ],
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
      const schema = { nodes: [], edges: [] };

      const result = await compiler.compile(schema);

      expect(result.nodes.size).toBe(0);
      expect(result.edges).toEqual([]);
    });

    it('should handle graph without edges', async () => {
      const schema = {
        nodes: [
          {
            id: 'node-1',
            kind: NodeKind.Runtime,
            template: 'test-template',
            config: {},
          },
        ],
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
            kind: NodeKind.Runtime,
            template: 'docker-runtime',
            config: { image: 'python:3.11' },
          },
          {
            id: 'tool-1',
            kind: NodeKind.Tool,
            template: 'shell-tool',
            config: { runtimeNodeId: 'runtime-1' },
          },
        ],
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
            kind: NodeKind.Runtime,
            template: 'test',
            config: {},
          },
          {
            id: 'duplicate',
            kind: NodeKind.Runtime,
            template: 'test',
            config: {},
          },
        ],
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
            kind: NodeKind.Runtime,
            template: 'test',
            config: {},
          },
        ],
        edges: [{ from: 'missing-node', to: 'node-1' }],
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
            kind: NodeKind.Runtime,
            template: 'test',
            config: {},
          },
        ],
        edges: [{ from: 'node-1', to: 'missing-node' }],
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
            kind: NodeKind.Runtime,
            template: 'unregistered',
            config: {},
          },
        ],
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
            kind: NodeKind.Runtime,
            template: 'test',
            config: { key: 'value' },
          },
        ],
      };

      const validateSpy = vi
        .spyOn(templateRegistry, 'validateTemplateConfig')
        .mockReturnValue({ key: 'value' });
      vi.spyOn(templateRegistry, 'hasTemplate').mockReturnValue(true);

      compiler['validateSchema'](schema);

      expect(validateSpy).toHaveBeenCalledWith('test', { key: 'value' });
    });
  });
});
