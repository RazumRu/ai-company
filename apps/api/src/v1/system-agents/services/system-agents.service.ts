import { Injectable, OnModuleInit } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

import type { SystemAgentDefinition } from '../system-agents.types';
import { parseSystemAgentFile } from '../system-agents.utils';

@Injectable()
export class SystemAgentsService implements OnModuleInit {
  private readonly definitions = new Map<string, SystemAgentDefinition>();

  constructor(private readonly logger: DefaultLogger) {}

  onModuleInit(): void {
    const dir = path.join(process.cwd(), 'system-agents');

    if (!existsSync(dir)) {
      this.logger.warn(
        `System agents directory not found at ${dir}. Registering 0 agents.`,
      );
      return;
    }

    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch (err) {
      this.logger.warn(
        `Failed to read system agents directory at ${dir}: ${String(err)}`,
      );
      return;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      let fileContent: string;

      try {
        fileContent = readFileSync(filePath, 'utf-8');
      } catch (err) {
        this.logger.warn(
          `Failed to read system agent file ${filePath}: ${String(err)}`,
        );
        continue;
      }

      let definition: SystemAgentDefinition;
      try {
        definition = parseSystemAgentFile(filePath, fileContent);
      } catch (err) {
        this.logger.warn(
          `Skipping invalid system agent file ${filePath}: ${String(err)}`,
        );
        continue;
      }

      if (this.definitions.has(definition.id)) {
        throw new Error(
          `Duplicate system agent id '${definition.id}' found in file ${filePath}. System agent IDs must be unique.`,
        );
      }

      this.definitions.set(definition.id, definition);
      this.logger.log(
        `Loaded system agent: ${definition.id} (${definition.name})`,
      );
    }

    this.logger.log(`System agents loaded: ${this.definitions.size} agent(s)`);
  }

  getAll(): SystemAgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  getById(id: string): SystemAgentDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new NotFoundException(
        'SYSTEM_AGENT_NOT_FOUND',
        `System agent '${id}' not found`,
      );
    }
    return definition;
  }

  getByTemplateId(templateId: string): SystemAgentDefinition | undefined {
    return Array.from(this.definitions.values()).find(
      (def) => def.templateId === templateId,
    );
  }
}
