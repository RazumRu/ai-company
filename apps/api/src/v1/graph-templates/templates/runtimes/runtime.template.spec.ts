import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphNode } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import {
  RuntimeTemplate,
  RuntimeTemplateSchema,
  type RuntimeTemplateSchemaType,
} from './runtime.template';

interface RuntimeConfig {
  labels?: Record<string, string>;
  env?: Record<string, string>;
  initScript?: string | string[];
  initScriptTimeoutMs?: number;
}

describe('RuntimeTemplate', () => {
  let template: RuntimeTemplate;
  let runtimeProvider: RuntimeProvider;
  let mockRuntimeProvider: {
    provide: ReturnType<typeof vi.fn>;
    getDefaultRuntimeType: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRuntimeProvider = {
      provide: vi
        .fn()
        .mockResolvedValue({ runtime: {} as never, created: false }),
      getDefaultRuntimeType: vi.fn().mockReturnValue(RuntimeType.Docker),
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
    it('should parse config and strip unknown fields', () => {
      const config = {
        unexpected: 'value',
      };

      const parsed = RuntimeTemplateSchema.parse(config) as RuntimeConfig;
      expect(parsed).not.toHaveProperty('unexpected');
      expect(parsed).not.toHaveProperty('runtimeType');
    });

    it('should parse config with labels and env correctly', () => {
      const config = {
        labels: { team: 'backend' },
        env: { NODE_ENV: 'production' },
      };

      const parsed = RuntimeTemplateSchema.parse(config) as RuntimeConfig;
      expect(parsed.labels).toEqual({ team: 'backend' });
      expect(parsed.env).toEqual({ NODE_ENV: 'production' });
    });

    it('should parse empty config successfully', () => {
      const parsed = RuntimeTemplateSchema.parse({});
      expect(parsed).toBeDefined();
    });

    it('should strip runtimeType if provided (legacy config)', () => {
      const config = {
        runtimeType: 'Docker',
        env: { FOO: 'bar' },
      };

      const parsed = RuntimeTemplateSchema.parse(config) as RuntimeConfig;
      expect(parsed).not.toHaveProperty('runtimeType');
      expect(parsed.env).toEqual({ FOO: 'bar' });
    });

    it('should handle common fields', () => {
      const config = {
        env: { FOO: 'bar' },
        initScript: 'echo hello',
        initScriptTimeoutMs: 30000,
      };

      const configWithArray = {
        env: { FOO: 'bar' },
        initScript: ['echo hello', 'echo world'],
        initScriptTimeoutMs: 60000,
      };

      const parsed = RuntimeTemplateSchema.parse(config) as RuntimeConfig;
      const parsedArray = RuntimeTemplateSchema.parse(
        configWithArray,
      ) as RuntimeConfig;

      expect(parsed.env).toEqual({ FOO: 'bar' });
      expect(parsed.initScript).toBe('echo hello');
      expect(parsedArray.env).toEqual({ FOO: 'bar' });
      expect(parsedArray.initScript).toEqual(['echo hello', 'echo world']);
    });
  });

  describe('create', () => {
    it('should provide runtime thread provider using default runtime type', async () => {
      const config: RuntimeConfig = {
        initScriptTimeoutMs: 60_000,
      };

      const metadata = {
        graphId: 'test-graph-id',
        nodeId: 'test-node-id',
        name: 'test-node',
        version: '1.0.0',
        graph_created_by: 'user-1',
        graph_project_id: '11111111-1111-1111-1111-111111111111',
      };

      const handle = await template.create();
      const init: GraphNode<RuntimeConfig> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(
        init as GraphNode<RuntimeTemplateSchemaType>,
      );
      expect(instance).toBeInstanceOf(RuntimeThreadProvider);
      const providerParams = (instance as RuntimeThreadProvider).getParams();
      expect(providerParams.type).toBe(RuntimeType.Docker);
      expect(mockRuntimeProvider.getDefaultRuntimeType).toHaveBeenCalled();
      expect(runtimeProvider.provide).not.toHaveBeenCalled();

      await handle.configure(
        init as GraphNode<RuntimeTemplateSchemaType>,
        instance,
      );
    });

    it('should use Daytona type when default runtime type is Daytona', async () => {
      mockRuntimeProvider.getDefaultRuntimeType.mockReturnValue(
        RuntimeType.Daytona,
      );

      const config: RuntimeConfig = {};

      const metadata = {
        graphId: 'daytona-graph',
        nodeId: 'daytona-node',
        name: 'daytona-test',
        version: '1.0.0',
        graph_created_by: 'user-1',
        graph_project_id: '11111111-1111-1111-1111-111111111111',
      };

      const handle = await template.create();
      const init: GraphNode<RuntimeConfig> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };

      const instance = await handle.provide(
        init as GraphNode<RuntimeTemplateSchemaType>,
      );
      expect(instance).toBeInstanceOf(RuntimeThreadProvider);
      const providerParams = (instance as RuntimeThreadProvider).getParams();
      expect(providerParams.type).toBe(RuntimeType.Daytona);
    });
  });
});
