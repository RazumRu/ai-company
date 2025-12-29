import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphNode } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import {
  DockerRuntimeTemplate,
  DockerRuntimeTemplateSchema,
} from './docker-runtime.template';

describe('DockerRuntimeTemplate', () => {
  let template: DockerRuntimeTemplate;
  let runtimeProvider: RuntimeProvider;
  let mockRuntime: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create mock runtime
    mockRuntime = {
      start: vi.fn(),
      stop: vi.fn(),
    };

    // Create mock RuntimeProvider
    const mockRuntimeProvider = {
      provide: vi.fn().mockResolvedValue(mockRuntime),
    };

    vi.spyOn(DockerRuntime, 'getByLabels').mockResolvedValue(null);

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
    runtimeProvider = module.get<RuntimeProvider>(RuntimeProvider);
  });

  describe('schema validation', () => {
    it('should strip unknown fields while keeping required ones', () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'node:18',
        unexpected: 'value',
      };

      const parsed = DockerRuntimeTemplateSchema.parse(config);
      expect(parsed.runtimeType).toBe(RuntimeType.Docker);
      expect(parsed.image).toBe('node:18');
      expect(parsed).not.toHaveProperty('unexpected');
    });

    it('should require runtimeType', () => {
      expect(() => DockerRuntimeTemplateSchema.parse({})).toThrow();
    });
  });

  describe('create', () => {
    it('should create runtime instance in provide and start it exactly once in configure', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'test-image',
      };

      const metadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        name: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(init);
      expect(instance).toBe(mockRuntime);
      expect(mockRuntime.start).not.toHaveBeenCalled();

      await handle.configure(init, instance);

      expect(runtimeProvider.provide).toHaveBeenCalledOnce();
      expect(runtimeProvider.provide).toHaveBeenCalledWith({
        type: RuntimeType.Docker,
      });

      expect(mockRuntime.start).toHaveBeenCalledTimes(1);
      const startArgs = vi.mocked(mockRuntime.start).mock.calls[0]![0] as any;
      expect(startArgs).toMatchObject({
        image: 'test-image',
        recreate: true,
        containerName: 'rt-test-graph-id-test-node-id',
        network: 'ai-company-test-graph-id',
      });
    });

    it('should include system labels (and temporary label when provided)', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'test-image',
      };

      const metadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        version: '1.0.0',
        temporary: true,
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      const startArgs = vi.mocked(mockRuntime.start).mock.calls[0]![0] as any;
      expect(startArgs.labels).toMatchObject({
        'ai-company/graph_id': 'test-graph-id',
        'ai-company/node_id': 'test-node-id',
        'ai-company/graph_version': '1.0.0',
        'ai-company/dind': 'false',
        'ai-company/temporary': 'true',
      });
    });

    it('should stop first on subsequent configure calls (no double-start on initial compile)', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'test-image',
      };

      const metadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(init);
      await handle.configure(init, instance);
      expect(mockRuntime.stop).not.toHaveBeenCalled();
      expect(mockRuntime.start).toHaveBeenCalledTimes(1);

      await handle.configure(init, instance);
      expect(mockRuntime.stop).toHaveBeenCalledTimes(1);
      expect(mockRuntime.start).toHaveBeenCalledTimes(2);
    });
  });
});
