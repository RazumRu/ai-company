import { Injectable, OnModuleInit } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

import type { InstructionBlockDefinition } from '../instruction-blocks.types';
import { parseInstructionBlockFile } from '../instruction-blocks.utils';

@Injectable()
export class InstructionBlocksService implements OnModuleInit {
  private readonly definitions = new Map<string, InstructionBlockDefinition>();

  constructor(private readonly logger: DefaultLogger) {}

  onModuleInit(): void {
    const dir = path.join(process.cwd(), 'instruction-blocks');

    if (!existsSync(dir)) {
      this.logger.warn(
        `Instruction blocks directory not found at ${dir}. Registering 0 blocks.`,
      );
      return;
    }

    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch (err) {
      this.logger.warn(
        `Failed to read instruction blocks directory at ${dir}: ${String(err)}`,
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
          `Failed to read instruction block file ${filePath}: ${String(err)}`,
        );
        continue;
      }

      let definition: InstructionBlockDefinition;
      try {
        definition = parseInstructionBlockFile(filePath, fileContent);
      } catch (err) {
        this.logger.warn(
          `Skipping invalid instruction block file ${filePath}: ${String(err)}`,
        );
        continue;
      }

      if (this.definitions.has(definition.id)) {
        throw new Error(
          `Duplicate instruction block id '${definition.id}' found in file ${filePath}. Instruction block IDs must be unique.`,
        );
      }

      this.definitions.set(definition.id, definition);
      this.logger.log(
        `Loaded instruction block: ${definition.id} (${definition.name})`,
      );
    }

    this.logger.log(
      `Instruction blocks loaded: ${this.definitions.size} block(s)`,
    );
  }

  getAll(): InstructionBlockDefinition[] {
    return Array.from(this.definitions.values());
  }

  getById(id: string): InstructionBlockDefinition {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new NotFoundException(
        'INSTRUCTION_BLOCK_NOT_FOUND',
        `Instruction block '${id}' not found`,
      );
    }
    return definition;
  }

  getByTemplateId(templateId: string): InstructionBlockDefinition | undefined {
    return Array.from(this.definitions.values()).find(
      (def) => def.templateId === templateId,
    );
  }
}
