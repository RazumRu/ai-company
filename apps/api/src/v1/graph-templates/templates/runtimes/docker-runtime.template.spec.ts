import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphNode } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import {
  RuntimeTemplate,
  RuntimeTemplateSchema,
} from './docker-runtime.template';

describe('RuntimeTemplate', () => {
  let template: RuntimeTemplate;
  let runtimeProvider: RuntimeProvider;
  let mockRuntimeProvider: {
    provide: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRuntimeProvider = {
      provide: vi
        .fn()
        .mockResolvedValue({ runtime: {} as never, created: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RuntimeTemplate,
        {
          provide: RuntimeProvider,
          useValue: mockRuntimeProvider,
        },
      ],
    }).compile();

    template = module.get<RuntimeTemplate>(RuntimeTemplate);
    runtimeProvider = module.get<RuntimeProvider>(RuntimeProvider);
  });

  describe('schema validation', () => {
    it('should parse Docker config and strip unknown fields', () => {
      const config = {
        runtimeType: RuntimeType.Docker,
        unexpected: 'value',
      };

      const parsed = RuntimeTemplateSchema.parse(config);
      expect(parsed.runtimeType).toBe(RuntimeType.Docker);
      expect(parsed).not.toHaveProperty('unexpected');
    });

    it('should parse Daytona config correctly', () => {
      const config = {
        runtimeType: RuntimeType.Daytona,
        labels: { team: 'backend' },
        env: { NODE_ENV: 'production' },
      };

      const parsed = RuntimeTemplateSchema.parse(config);
      expect(parsed.runtimeType).toBe(RuntimeType.Daytona);
      expect(parsed.labels).toEqual({ team: 'backend' });
      expect(parsed.env).toEqual({ NODE_ENV: 'production' });
    });

    it('should reject missing runtimeType', () => {
      expect(() => RuntimeTemplateSchema.parse({})).toThrow();
    });

    it('should reject invalid runtimeType', () => {
      expect(() =>
        RuntimeTemplateSchema.parse({ runtimeType: 'InvalidType' }),
      ).toThrow();
    });

    it('should handle common fields for both Docker and Daytona', () => {
      const dockerConfig = {
        runtimeType: RuntimeType.Docker,
        env: { FOO: 'bar' },
        initScript: 'echo hello',
        initScriptTimeoutMs: 30000,
      };
      const daytonaConfig = {
        runtimeType: RuntimeType.Daytona,
        env: { FOO: 'bar' },
        initScript: ['echo hello', 'echo world'],
        initScriptTimeoutMs: 60000,
      };

      const parsedDocker = RuntimeTemplateSchema.parse(dockerConfig);
      const parsedDaytona = RuntimeTemplateSchema.parse(daytonaConfig);

      expect(parsedDocker.env).toEqual({ FOO: 'bar' });
      expect(parsedDocker.initScript).toBe('echo hello');
      expect(parsedDaytona.env).toEqual({ FOO: 'bar' });
      expect(parsedDaytona.initScript).toEqual(['echo hello', 'echo world']);
    });
  });

  describe('create', () => {
    it('should provide runtime thread provider with Docker type', async () => {
      const config = {
        runtimeType: RuntimeType.Docker as const,
        initScriptTimeoutMs: 60_000,
      };

      const metadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        name: 'test-node',
        version: '1.0.0',
        graph_created_by: 'user-1',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(init);
      expect(instance).toBeInstanceOf(RuntimeThreadProvider);
      const providerParams = (instance as RuntimeThreadProvider).getParams();
      expect(providerParams.type).toBe(RuntimeType.Docker);
      expect(runtimeProvider.provide).not.toHaveBeenCalled();

      await handle.configure(init, instance);
    });

    it('should pass correct RuntimeType for Daytona config', async () => {
      const config = {
        runtimeType: RuntimeType.Daytona as const,
      };

      const metadata = {
        graphId: 'daytona-graph',
        nodeId: 'daytona-node',
        name: 'daytona-test',
        version: '1.0.0',
        graph_created_by: 'user-1',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(init);
      expect(instance).toBeInstanceOf(RuntimeThreadProvider);
      const providerParams = (instance as RuntimeThreadProvider).getParams();
      expect(providerParams.type).toBe(RuntimeType.Daytona);
    });
  });
});
