import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { NodeBaseTemplateMetadata } from '../base-node.template';
import { DockerRuntimeTemplate } from './docker-runtime.template';

describe('DockerRuntimeTemplate', () => {
  let template: DockerRuntimeTemplate;
  let runtimeProvider: RuntimeProvider;
  let mockRuntime: any;

  beforeEach(async () => {
    // Create mock runtime
    mockRuntime = {
      start: vi.fn(),
      stop: vi.fn(),
      exec: vi.fn(),
    };

    // Create mock RuntimeProvider
    const mockRuntimeProvider = {
      provide: vi.fn().mockResolvedValue(mockRuntime),
    };

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

  describe('create', () => {
    it('should create runtime with recreate flag set to true', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'test-image',
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        name: 'test-node',
        version: '1.0.0',
      };

      const result = await template.create(
        config,
        new Set(),
        new Set(),
        metadata,
      );

      expect(runtimeProvider.provide).toHaveBeenCalledOnce();
      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];

      // Verify recreate flag is true
      expect(callArgs.recreate).toBe(true);
      expect(callArgs.autostart).toBe(true);
      expect(result).toBe(mockRuntime);
    });

    it('should always pass recreate=true regardless of config', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        image: 'test-image',
        env: { TEST: 'value' },
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'graph-123',
        nodeId: 'node-456',
        name: 'runtime-node',
        version: '1.0.0',
      };

      await template.create(config, new Set(), new Set(), metadata);

      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];
      expect(callArgs.recreate).toBe(true);
    });

    it('should include system labels with graph_id and node_id', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'my-graph',
        nodeId: 'my-node',
        name: 'test',
        version: '1.0.0',
      };

      await template.create(config, new Set(), new Set(), metadata);

      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];
      expect(callArgs.labels['ai-company/graph_id']).toBe('my-graph');
      expect(callArgs.labels['ai-company/node_id']).toBe('my-node');
    });

    it('should include temporary label when graph is temporary', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'temp-graph',
        nodeId: 'temp-node',
        name: 'test',
        version: '1.0.0',
        temporary: true,
      };

      await template.create(config, new Set(), new Set(), metadata);

      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];
      expect(callArgs.labels['ai-company/temporary']).toBe('true');
    });

    it('should generate network name from graph id', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'my-unique-graph-id',
        nodeId: 'node',
        name: 'test',
        version: '1.0.0',
      };

      await template.create(config, new Set(), new Set(), metadata);

      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];
      expect(callArgs.network).toBe('ai-company-my-unique-graph-id');
    });

    it('should generate container name from graph and node id', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
      };

      const metadata: NodeBaseTemplateMetadata = {
        graphId: 'graph-abc',
        nodeId: 'node-xyz',
        name: 'test',
        version: '1.0.0',
      };

      await template.create(config, new Set(), new Set(), metadata);

      const callArgs = (runtimeProvider.provide as any).mock.calls[0][0];
      expect(callArgs.containerName).toBe('rt-graph-abc-node-xyz');
    });
  });
});
