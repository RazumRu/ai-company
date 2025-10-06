import { SetMetadata } from '@nestjs/common';

export const AGENT_FACTORY_KEY = 'agentFactory';

/**
 * Decorator to mark a class as an agent factory
 * This allows automatic discovery and registration of agent factories
 */
export const RegisterAgent = () => SetMetadata(AGENT_FACTORY_KEY, true);
