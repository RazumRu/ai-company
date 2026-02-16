import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { randomUUID } from 'crypto';

import { GraphEntity } from '../entity/graph.entity';
import { GraphStatus } from '../graphs.types';
import { GraphCompiler } from './graph-compiler';
import { GraphRegistry } from './graph-registry';

export interface GraphAiContext {
  /**
   * The graphId registered in GraphRegistry for this AI operation.
   * - If the graph is already compiled/running, this is the real graphId.
   * - Otherwise, this is a temporary previewGraphId.
   */
  registryGraphId: string;
  /**
   * If present, indicates a temporary preview graph was compiled and must be cleaned up.
   */
  previewGraphId?: string;
}

@Injectable()
export class GraphAiPreviewService {
  constructor(
    private readonly graphRegistry: GraphRegistry,
    private readonly graphCompiler: GraphCompiler,
    private readonly logger: DefaultLogger,
  ) {}

  async withGraphAiContext<T>(
    graph: GraphEntity,
    fn: (ctx: GraphAiContext) => Promise<T>,
  ): Promise<T> {
    const existing = this.graphRegistry.get(graph.id);
    const existingStatus = this.graphRegistry.getStatus(graph.id);

    // Only reuse an existing graph when it is fully constructed and Running.
    // Avoid using graphs that are still Compiling or in any other non-running state.
    if (existing && existingStatus === GraphStatus.Running) {
      return fn({ registryGraphId: graph.id });
    }

    const previewGraphId = randomUUID();

    try {
      await this.graphCompiler.compile(
        graph,
        {
          graphId: previewGraphId,
          temporary: true,
        },
        { mode: 'AiPreview' },
      );

      return await fn({ registryGraphId: previewGraphId, previewGraphId });
    } finally {
      try {
        await this.graphRegistry.destroy(previewGraphId);
      } catch (error) {
        this.logger.error(
          error as Error,
          `Failed to cleanup preview graph: graphId=${graph.id}, previewGraphId=${previewGraphId}`,
        );
      }
    }
  }
}

export const withGraphAiContext = async <T>(
  service: GraphAiPreviewService,
  graph: GraphEntity,
  fn: (ctx: GraphAiContext) => Promise<T>,
): Promise<T> => service.withGraphAiContext(graph, fn);
