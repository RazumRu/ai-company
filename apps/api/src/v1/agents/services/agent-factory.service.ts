import { Injectable } from '@nestjs/common';
import { ContextId, ModuleRef } from '@nestjs/core';
import { BadRequestException } from '@packages/common';
import { Class } from 'type-fest';

import { BaseAgent } from './agents/base-agent';

/**
 * Service that provides agent factory functions
 * These are automatically discovered and registered via decorators
 */
@Injectable()
export class AgentFactoryService {
  private agents = new Set<Class<BaseAgent<unknown>>>();

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Register an agent factory
   */
  register(agentType: Class<BaseAgent<unknown>>) {
    this.agents.add(agentType);
  }

  /**
   * Get an agent factory by type
   */
  create<T extends BaseAgent<unknown>>(
    agentType: Class<T>,
    ctx?: ContextId,
  ): Promise<T> {
    const instance = this.agents.has(agentType);
    if (!instance) {
      throw new BadRequestException(
        undefined,
        `Unknown instance "${agentType.name}"`,
      );
    }

    return this.moduleRef.resolve<T>(agentType, ctx, { strict: false });
  }
}
