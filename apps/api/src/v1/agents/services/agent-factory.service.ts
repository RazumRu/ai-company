import { Injectable } from '@nestjs/common';
import { ContextId, ModuleRef } from '@nestjs/core';
import { Class } from 'type-fest';

import { BaseAgent } from './agents/base-agent';

/**
 * Service that provides agent factory functions
 * These are automatically discovered and registered via decorators
 */
@Injectable()
export class AgentFactoryService {
  private agents = new Set<Class<BaseAgent<any>>>();

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Register an agent factory
   */
  register(agentType: Class<BaseAgent<any>>) {
    this.agents.add(agentType);
  }

  /**
   * Get an agent factory by type
   */
  create<T extends BaseAgent<any>>(
    agentType: Class<T>,
    ctx?: ContextId,
  ): Promise<T> {
    const instance = this.agents.has(agentType);
    if (!instance) throw new Error(`Unknown instance "${agentType.name}"`);

    return this.moduleRef.resolve<T>(agentType, ctx, { strict: false });
  }
}
