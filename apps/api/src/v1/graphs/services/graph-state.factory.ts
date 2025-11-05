import { Injectable } from '@nestjs/common';
import { ContextId, ModuleRef } from '@nestjs/core';

import { GraphStateManager } from './graph-state.manager';

@Injectable()
export class GraphStateFactory {
  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Get an agent factory by type
   */
  async create(graphId: string, ctx?: ContextId): Promise<GraphStateManager> {
    const stateManager = await this.moduleRef.resolve(GraphStateManager, ctx);

    stateManager.setGraphId(graphId);

    return stateManager;
  }
}
