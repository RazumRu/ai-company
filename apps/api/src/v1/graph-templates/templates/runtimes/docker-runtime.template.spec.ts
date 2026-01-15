import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphNode } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import {
  DockerRuntimeTemplate,
  DockerRuntimeTemplateSchema,
} from './docker-runtime.template';

describe('DockerRuntimeTemplate', () => {
  let template: DockerRuntimeTemplate;
  let runtimeProvider: RuntimeProvider;
  let mockRuntimeProvider: {
    provide: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRuntimeProvider = {
      provide: vi.fn().mockResolvedValue({}),
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
    it('should provide runtime thread provider', async () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        initScriptTimeoutMs: 60_000,
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
      expect(typeof (instance as any).provide).toBe('function');
      expect(runtimeProvider.provide).not.toHaveBeenCalled();

      await handle.configure(init, instance);
    });
  });
});
