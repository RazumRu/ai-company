import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphAiPreviewService } from './graph-ai-preview.service';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';

describe('GraphAiPreviewService', () => {
  let graphRegistry: Pick<GraphRegistry, 'get' | 'getStatus' | 'destroy'>;
  let graphCompiler: Pick<GraphCompiler, 'compile'>;
  let logger: { error: (error: Error, msg?: string) => void };

  const graph: GraphEntity = {
    id: 'graph-1',
    name: 'Test Graph',
    description: undefined,
    error: undefined,
    version: '1.0.0',
    targetVersion: '1.0.0',
    schema: { nodes: [], edges: [] },
    status: GraphStatus.Created,
    metadata: null,
    temporary: false,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as unknown as GraphEntity;

  beforeEach(() => {
    graphRegistry = {
      get: vi.fn(),
      getStatus: vi.fn(),
      destroy: vi.fn(async () => undefined),
    };

    graphCompiler = {
      compile: vi.fn(async () => {
        throw new Error('compile not mocked');
      }),
    };

    logger = {
      error: vi.fn(),
    };
  });

  it('reuses existing graph only when GraphRegistry status is Running', async () => {
    (graphRegistry.get as any).mockReturnValue({});
    (graphRegistry.getStatus as any)
      .mockReturnValueOnce(GraphStatus.Compiling)
      .mockReturnValueOnce(GraphStatus.Running);

    (graphCompiler.compile as any).mockResolvedValue({});

    const service = new GraphAiPreviewService(
      graphRegistry as GraphRegistry,
      graphCompiler as GraphCompiler,
      logger as any,
    );

    // When status is Compiling, do not reuse existing; compile preview graph.
    const ctx1 = await service.withGraphAiContext(graph, async (ctx) => ctx);
    expect(ctx1.registryGraphId).not.toBe(graph.id);
    expect(ctx1.previewGraphId).toBeDefined();

    // When status is Running, reuse existing graphId and do not compile.
    const ctx2 = await service.withGraphAiContext(graph, async (ctx) => ctx);
    expect(ctx2).toEqual({ registryGraphId: graph.id });

    expect(graphCompiler.compile).toHaveBeenCalledTimes(1);
  });

  it('marks compiled preview graphs as temporary in additional metadata', async () => {
    (graphRegistry.get as any).mockReturnValue(undefined);
    (graphRegistry.getStatus as any).mockReturnValue(undefined);

    (graphCompiler.compile as any).mockResolvedValue({});

    const service = new GraphAiPreviewService(
      graphRegistry as GraphRegistry,
      graphCompiler as GraphCompiler,
      logger as any,
    );

    await service.withGraphAiContext(graph, async () => 'ok');

    expect(graphCompiler.compile).toHaveBeenCalledTimes(1);
    const [, additionalMetadata, compileOptions] = (
      graphCompiler.compile as any
    ).mock.calls[0];

    expect(additionalMetadata).toEqual(
      expect.objectContaining({ graphId: expect.any(String), temporary: true }),
    );
    expect(compileOptions).toEqual({ mode: 'AiPreview' });
  });
});
