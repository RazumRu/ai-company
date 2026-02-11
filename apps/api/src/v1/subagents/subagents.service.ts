import { Injectable } from '@nestjs/common';

import { SYSTEM_AGENTS } from './subagent-definitions';
import { SubagentDefinition } from './subagents.types';

@Injectable()
export class SubagentsService {
  /** Return all registered subagent definitions. */
  getAllSystem(): readonly SubagentDefinition[] {
    return SYSTEM_AGENTS;
  }

  /** Look up a subagent definition by ID. Returns undefined if not found. */
  getById(id: string): SubagentDefinition | undefined {
    return SYSTEM_AGENTS.find((d) => d.id === id);
  }
}
