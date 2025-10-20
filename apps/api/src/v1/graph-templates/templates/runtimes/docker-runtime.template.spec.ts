import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeKind } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import {
  DockerRuntimeTemplate,
  DockerRuntimeTemplateSchema,
} from './docker-runtime.template';

describe('DockerRuntimeTemplate', () => {
  let template: DockerRuntimeTemplate;
  let mockRuntimeProvider: RuntimeProvider;

  beforeEach(async () => {
    mockRuntimeProvider = {
      provide: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DockerRuntimeTemplate,
        {
          provide: RuntimeProvider,
          useValue: mockRuntimeProvider,
        },
      ],
    }).compile();

    template = module.get<DockerRuntimeTemplate>(DockerRuntimeTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('docker-runtime');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'Docker runtime environment for executing code',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Runtime);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(DockerRuntimeTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate required fields', () => {
      const validConfig = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should validate optional fields', () => {
      const validConfig = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        workdir: '/app',
        env: { NODE_ENV: 'production', DEBUG: 'true' },
        labels: { version: '1.0.0', team: 'backend' },
        initScript: ['npm install', 'npm run build'],
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const invalidConfig = {
        // missing runtimeType and image
        workdir: '/app',
      };

      expect(() => DockerRuntimeTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject invalid runtimeType', () => {
      const invalidConfig = {
        runtimeType: 'invalid-type',
        image: 'python:3.11',
      };

      expect(() => DockerRuntimeTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should validate initScript as string or array', () => {
      const configWithString = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScript: 'npm install',
      };

      const configWithArray = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScript: ['npm install', 'npm run build'],
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(configWithString),
      ).not.toThrow();
      expect(() =>
        DockerRuntimeTemplateSchema.parse(configWithArray),
      ).not.toThrow();
    });

    it('should validate initScriptTimeoutMs as positive number', () => {
      const configWithTimeout = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScriptTimeoutMs: 300000, // 5 minutes
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(configWithTimeout),
      ).not.toThrow();
    });

    it('should reject negative initScriptTimeoutMs', () => {
      const configWithNegativeTimeout = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScriptTimeoutMs: -1000,
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(configWithNegativeTimeout),
      ).toThrow();
    });

    it('should reject zero initScriptTimeoutMs', () => {
      const configWithZeroTimeout = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScriptTimeoutMs: 0,
      };

      expect(() =>
        DockerRuntimeTemplateSchema.parse(configWithZeroTimeout),
      ).toThrow();
    });
  });

  describe('create', () => {
    it('should create runtime with minimal configuration', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      mockRuntimeProvider.provide = vi.fn().mockResolvedValue(mockRuntime);

      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
      };

      const result = await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntimeProvider.provide).toHaveBeenCalledWith({
        type: RuntimeType.Docker,
        image: 'python:3.11',
        env: undefined,
        workdir: undefined,
        labels: {
          'ai-company/graph_id': 'test-graph',
          'ai-company/node_id': 'test-node',
        },
        initScript: undefined,
        initScriptTimeoutMs: undefined,
        autostart: true,
        containerName: 'rt-test-graph-test-node',
        'network': 'ai-company-test-graph',
      });
      expect(result).toBe(mockRuntime);
    });

    it('should create runtime with full configuration', async () => {
      const mockRuntime = {
        id: 'runtime-2',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      mockRuntimeProvider.provide = vi.fn().mockResolvedValue(mockRuntime);

      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'node:20',
        workdir: '/app',
        env: { NODE_ENV: 'production', PORT: '3000' },
        labels: { version: '2.0.0', environment: 'prod' },
        initScript: ['npm ci', 'npm run build'],
      };

      const result = await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntimeProvider.provide).toHaveBeenCalledWith({
        type: RuntimeType.Docker,
        image: 'node:20',
        env: { NODE_ENV: 'production', PORT: '3000' },
        workdir: '/app',
        labels: {
          version: '2.0.0',
          environment: 'prod',
          'ai-company/graph_id': 'test-graph',
          'ai-company/node_id': 'test-node',
        },
        initScript: ['npm ci', 'npm run build'],
        initScriptTimeoutMs: undefined,
        autostart: true,
        containerName: 'rt-test-graph-test-node',
        'network': 'ai-company-test-graph',
      });
      expect(result).toBe(mockRuntime);
    });

    it('should handle runtime provider errors', async () => {
      const mockError = new Error('Failed to create runtime');
      mockRuntimeProvider.provide = vi.fn().mockRejectedValue(mockError);

      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
      };

      await expect(
        template.create(config, new Map(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to create runtime');
    });

    it('should always set autostart to true', async () => {
      const mockRuntime = {
        id: 'runtime-3',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      mockRuntimeProvider.provide = vi.fn().mockResolvedValue(mockRuntime);

      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'alpine:latest',
      };

      await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntimeProvider.provide).toHaveBeenCalledWith(
        expect.objectContaining({
          autostart: true,
        }),
      );
    });

    it('should create runtime with initScriptTimeoutMs', async () => {
      const mockRuntime = {
        id: 'runtime-4',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      mockRuntimeProvider.provide = vi.fn().mockResolvedValue(mockRuntime);

      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'python:3.11',
        initScript: 'pip install -r requirements.txt',
        initScriptTimeoutMs: 300000, // 5 minutes
      };

      const result = await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntimeProvider.provide).toHaveBeenCalledWith({
        type: RuntimeType.Docker,
        image: 'python:3.11',
        env: undefined,
        workdir: undefined,
        labels: {
          'ai-company/graph_id': 'test-graph',
          'ai-company/node_id': 'test-node',
        },
        initScript: 'pip install -r requirements.txt',
        initScriptTimeoutMs: 300000,
        autostart: true,
        containerName: 'rt-test-graph-test-node',
        'network': 'ai-company-test-graph',
      });
      expect(result).toBe(mockRuntime);
    });
  });
});
